'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

const { fromVendor } = require('./transformer');

const STATIC_DIR = path.join(__dirname, '..', 'public');

class Dashboard extends EventEmitter {
    constructor(simulator, opts = {}) {
        super();
        this.simulator = simulator;
        this.sensors = opts.sensors || null;
        this.port = opts.port || 8080;
        this.bindAddress = opts.bindAddress || '0.0.0.0';
        this._server = null;
        this._sseClients = new Set();

        simulator.on('state-change', payload =>
            this._broadcast('state', payload)
        );
        simulator.on('packet-dropped', () =>
            this._broadcast('stats', simulator.stats)
        );
        if (this.sensors) {
            this.sensors.on('change', payload =>
                this._broadcast('sensors', payload.state)
            );
        }
    }

    start() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) =>
                this._handle(req, res)
            );
            server.on('error', reject);
            server.listen(this.port, this.bindAddress, () => {
                this._server = server;
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

            if (route === 'GET /api/state') return this._sendState(res);
            if (route === 'GET /api/stats') return this._sendStats(res);
            if (route === 'GET /api/faults') return this._sendFaults(res);
            if (route === 'POST /api/faults')
                return this._updateFaults(req, res);
            if (route === 'POST /api/set') return this._setProperty(req, res);
            if (route === 'POST /api/temperature')
                return this._setCurrentTemperature(req, res);
            if (route === 'GET /api/sensors') return this._sendSensors(res);
            if (route === 'POST /api/sensors')
                return this._updateSensors(req, res);
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
                    : 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': type });
            res.end(data);
        });
    }

    _sendState(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this._stateSnapshot()));
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

    _setProperty(req, res) {
        this._readJson(req)
            .then(body => {
                if (!body || typeof body !== 'object') {
                    throw new Error(
                        'expected JSON object of {prop: value, ...}'
                    );
                }
                const keys = Object.keys(body);
                const opts = [];
                const vals = [];
                for (const k of keys) {
                    opts.push(k);
                    vals.push(body[k]);
                }
                this.simulator.state.apply(opts, vals, 'http');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this._stateSnapshot()));
            })
            .catch(err => {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end(err.message);
            });
    }

    _setCurrentTemperature(req, res) {
        this._readJson(req)
            .then(body => {
                const celsius = Number(body && body.celsius);
                if (!Number.isFinite(celsius)) {
                    throw new Error('expected { "celsius": <number> }');
                }
                this.simulator.state.setCurrentTemperature(celsius, 'http');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this._stateSnapshot()));
            })
            .catch(err => {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end(err.message);
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
        if (this.sensors) {
            this._writeEvent(res, 'sensors', this.sensors.snapshot());
        }
    }

    _sendSensors(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.sensors ? this.sensors.snapshot() : {}));
    }

    _updateSensors(req, res) {
        if (!this.sensors) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('sensors not configured');
            return;
        }
        this._readJson(req)
            .then(body => {
                this.sensors.update(body || {});
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this.sensors.snapshot()));
            })
            .catch(err => {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end(err.message);
            });
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
                } catch (e) {
                    reject(new Error('invalid JSON'));
                }
            });
            req.on('error', reject);
        });
    }

    _stateSnapshot() {
        const raw = this.simulator.state.all;
        const friendly = fromVendor(raw);
        return {
            cid: this.simulator.cid,
            name: this.simulator.name,
            brand: this.simulator.brand,
            model: this.simulator.model,
            cipher: this.simulator.cipherMode,
            deviceKey: this.simulator.deviceKey,
            vendor: raw,
            friendly,
            // Decode current temperature for display
            currentTemperatureC: raw.TemSen === 0 ? null : raw.TemSen - 40,
            // Origin of the most recent change (flow / dashboard / sim)
            lastChange: this.simulator.state.lastChange,
        };
    }
}

module.exports = { Dashboard };
