'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

const {
    fromVendor,
    displaySetpoint,
    OPTIONAL_CODES,
} = require('./transformer');

const STATIC_DIR = path.join(__dirname, '..', 'public');

class Dashboard extends EventEmitter {
    constructor(simulator, opts = {}) {
        super();
        this.simulator = simulator;
        this.port = opts.port ?? 8080;
        this.bindAddress = opts.bindAddress || '0.0.0.0';
        this._server = null;
        this._sseClients = new Set();

        simulator.on('state-change', payload =>
            this._broadcast('state', payload)
        );
        simulator.on('packet-dropped', () =>
            this._broadcast('stats', simulator.stats)
        );
    }

    start() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) =>
                this._handle(req, res)
            );
            server.on('error', reject);
            server.listen(this.port, this.bindAddress, () => {
                this._server = server;
                // reflect the actual port for port-0 (ephemeral) binds
                this.port = server.address().port;
                this.emit('listening', {
                    address: this.bindAddress,
                    port: this.port,
                });
                this._statsInterval = setInterval(() => {
                    this._broadcast('stats', this.simulator.stats);
                }, 2000);
                this._statsInterval.unref();
                resolve();
            });
        });
    }

    stop() {
        return new Promise(resolve => {
            if (this._statsInterval) clearInterval(this._statsInterval);
            for (const client of this._sseClients) {
                try {
                    client.end();
                } catch (_) {
                    /* ignore */
                }
            }
            this._sseClients.clear();
            if (!this._server) return resolve();
            this._server.close(() => resolve());
            this._server = null;
        });
    }

    _handle(req, res) {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const route = `${req.method} ${url.pathname}`;

            if (route === 'GET /') return this._serveStatic('index.html', res);
            if (route === 'GET /app.js')
                return this._serveStatic('app.js', res);
            if (route === 'GET /styles.css')
                return this._serveStatic('styles.css', res);
            if (route === 'GET /logo.svg')
                return this._serveStatic('logo.svg', res);
            if (route === 'GET /favicon.ico')
                return this._serveStatic('logo.svg', res);

            // ?unit=<indoor-unit MAC> addresses an indoor unit of a
            // multi-split gateway; without it, the unit itself
            const unit = url.searchParams.get('unit') || null;

            if (route === 'GET /api/state') return this._sendState(res, unit);
            if (route === 'GET /api/stats') return this._sendStats(res);
            if (route === 'POST /api/stats/reset') {
                this.simulator.resetStats();
                this._broadcast('stats', this.simulator.stats);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this.simulator.stats));
                return;
            }
            if (route === 'GET /api/faults') return this._sendFaults(res);
            if (route === 'POST /api/faults')
                return this._updateFaults(req, res);
            if (route === 'POST /api/set')
                return this._setProperty(req, res, unit);
            if (route === 'POST /api/temperature')
                return this._setCurrentTemperature(req, res, unit);
            if (route === 'POST /api/outdoor-temperature')
                return this._setOutdoorTemperature(req, res, unit);
            if (route === 'POST /api/name') return this._setName(req, res);
            if (route === 'POST /api/clock') return this._setClock(req, res);
            if (route === 'POST /api/features')
                return this._setFeatures(req, res, unit);
            if (route === 'GET /api/events') return this._sse(req, res);

            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(e.message);
        }
    }

    _serveStatic(name, res) {
        const file = path.join(STATIC_DIR, name);
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
                return;
            }
            const ext = path.extname(name);
            const type =
                ext === '.html'
                    ? 'text/html; charset=utf-8'
                    : ext === '.js'
                      ? 'application/javascript; charset=utf-8'
                      : ext === '.css'
                        ? 'text/css; charset=utf-8'
                        : ext === '.svg'
                          ? 'image/svg+xml; charset=utf-8'
                          : 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': type });
            res.end(data);
        });
    }

    _sendState(res, unit) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this._stateSnapshot(unit)));
    }

    /**
     * Read a JSON body, apply it with `action` (which throws on bad input)
     * and answer with the state snapshot, or 400 with the error.
     *
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse} res
     * @param {string|null} unit
     * @param {Function} action
     */
    _update(req, res, unit, action) {
        this._readJson(req)
            .then(body => {
                action(body);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this._stateSnapshot(unit)));
            })
            .catch(err => {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end(err.message);
            });
    }

    _setOutdoorTemperature(req, res, unit) {
        this._update(req, res, unit, body => {
            const celsius = Number(body && body.celsius);
            if (!Number.isFinite(celsius)) {
                throw new Error('expected { "celsius": <number> }');
            }
            this.simulator
                .unitState(unit)
                .setOutdoorTemperature(celsius, 'http');
        });
    }

    _setName(req, res) {
        this._update(req, res, null, body => {
            if (!this.simulator.setName(body && body.name, 'http')) {
                throw new Error('expected { "name": <non-empty string> }');
            }
        });
    }

    _setClock(req, res) {
        this._update(req, res, null, body => {
            // no time: set the unit's clock to now
            const time = body && body.time ? body.time : new Date();
            if (!this.simulator.setClock(time, 'http')) {
                throw new Error('expected { "time": "YYYY-MM-DD HH:MM:SS" }');
            }
        });
    }

    _setFeatures(req, res, unit) {
        this._update(req, res, unit, body => {
            const features = body && body.features;
            if (!Array.isArray(features) && typeof features !== 'string') {
                throw new Error(
                    'expected { "features": [<code or name>, ...] | "all" | "none" }'
                );
            }
            this.simulator.unitState(unit).setFeatures(features);
        });
    }

    _sendStats(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.simulator.stats));
    }

    _sendFaults(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.simulator.faults.snapshot()));
    }

    _updateFaults(req, res) {
        this._readJson(req)
            .then(body => {
                this.simulator.faults.update(body || {});
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this.simulator.faults.snapshot()));
            })
            .catch(err => {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end(err.message);
            });
    }

    _setProperty(req, res, unit) {
        this._update(req, res, unit, body => {
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
                throw new Error('expected JSON object of {prop: value, ...}');
            }
            this.simulator
                .unitState(unit)
                .apply(Object.keys(body), Object.values(body), 'http');
        });
    }

    _setCurrentTemperature(req, res, unit) {
        this._update(req, res, unit, body => {
            const celsius = Number(body && body.celsius);
            if (!Number.isFinite(celsius)) {
                throw new Error('expected { "celsius": <number> }');
            }
            this.simulator
                .unitState(unit)
                .setCurrentTemperature(celsius, 'http');
        });
    }

    _sse(req, res) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.write(': connected\n\n');
        this._sseClients.add(res);

        const heartbeat = setInterval(() => {
            try {
                res.write(': hb\n\n');
            } catch (_) {
                /* will be cleaned up on close */
            }
        }, 15000);
        heartbeat.unref();

        req.on('close', () => {
            clearInterval(heartbeat);
            this._sseClients.delete(res);
        });

        // Push current snapshot on connect
        this._writeEvent(res, 'state', this._stateSnapshot());
        this._writeEvent(res, 'stats', this.simulator.stats);
    }

    _broadcast(event, data) {
        for (const res of this._sseClients) {
            this._writeEvent(res, event, data);
        }
    }

    _writeEvent(res, event, data) {
        try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (_) {
            this._sseClients.delete(res);
        }
    }

    _readJson(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', chunk => {
                data += chunk;
                if (data.length > 64 * 1024) {
                    reject(new Error('payload too large'));
                    req.destroy();
                }
            });
            req.on('end', () => {
                if (!data) return resolve({});
                try {
                    resolve(JSON.parse(data));
                } catch (_) {
                    reject(new Error('invalid JSON'));
                }
            });
            req.on('error', reject);
        });
    }

    _stateSnapshot(unit = null) {
        const sim = this.simulator;
        const subUnits = sim.subUnits;
        const known = unit && subUnits.some(u => u.mac === unit);
        const state = sim.unitState(known ? unit : null);
        const raw = state.all;
        const friendly = fromVendor(raw);
        const features = OPTIONAL_CODES.filter(c => state.features.has(c));
        return {
            cid: sim.cid,
            name: sim.name,
            brand: sim.brand,
            model: sim.model,
            version: sim.version,
            hid: sim.hid,
            cipher: sim.cipherMode,
            deviceKey: sim.deviceKey,
            // the unit's clock, `YYYY-MM-DD HH:MM:SS`
            clock: sim.clock,
            // last WiFi setup request (AP mode), without the password
            wifi: sim.wifi,
            // indoor units of a multi-split gateway, and the one shown
            subUnits,
            unit: known ? unit : null,
            vendor: raw,
            friendly,
            // optional vendor codes this unit answers
            features,
            // setpoint as the unit shows it (°F via TemRec, half °C via Add0.5)
            setpoint: displaySetpoint(raw),
            // Decode current temperature for display
            currentTemperatureC: raw.TemSen === 0 ? null : raw.TemSen - 40,
            outdoorTemperatureC:
                !features.includes('OutEnvTem') || raw.OutEnvTem === 0
                    ? null
                    : raw.OutEnvTem - 40,
            // Origin of the most recent change (flow / dashboard / sim)
            lastChange: state.lastChange,
            // beeper flags of the last Gree command: {at, silent, unit}
            lastCommand: sim.lastCommand,
        };
    }
}

module.exports = { Dashboard };
