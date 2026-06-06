'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');

/**
 * Normalise a MAC / cid for comparison: lower-case, strip every separator so
 * `AA:BB:CC`, `aabbcc` and `aa-bb-cc` all compare equal.
 * @param {string} mac
 * @returns {string} normalised hex string (may be empty)
 */
const normalizeMac = mac =>
    String(mac || '')
        .toLowerCase()
        .replace(/[^a-f0-9]/g, '');

/**
 * Perform a single Gree discovery scan and resolve the IP of the device whose
 * cid/MAC matches `mac`. Resolves to the address string, or `null` if no match
 * was seen within the listen window. Like {@link gree-hvac-discover}, we do not
 * decrypt responses — the cid travels in the *unencrypted* envelope, which is
 * all we need to map MAC → current IP.
 *
 * Rejects only on socket setup/send failures; a window that simply sees no
 * matching device resolves to `null` (a benign "not found", not an error).
 * @param {object} opts
 * @param {string} opts.mac                       device cid/MAC to resolve
 * @param {number} [opts.port]                    discovery port (default 7000)
 * @param {string} [opts.broadcastAddress]        default 255.255.255.255
 * @param {number} [opts.listenWindowMs]          how long to listen (default 2000)
 * @param {object} [opts.dgramModule]             dgram-like module (DI for tests)
 * @returns {Promise<string|null>} resolved IP, or null if not found in the window
 */
function scanForMac(opts = {}) {
    const {
        mac,
        port = 7000,
        broadcastAddress = '255.255.255.255',
        listenWindowMs = 2000,
        dgramModule = dgram,
    } = opts;

    return new Promise((resolve, reject) => {
        const target = normalizeMac(mac);
        if (!target) {
            resolve(null);
            return;
        }

        const socket = dgramModule.createSocket('udp4');
        let settled = false;
        let timer = null;

        const close = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            try {
                socket.close();
            } catch (_) {
                /* already closed */
            }
        };
        const succeed = addr => {
            if (settled) return;
            settled = true;
            close();
            resolve(addr);
        };
        const fail = err => {
            if (settled) return;
            settled = true;
            close();
            reject(err);
        };

        socket.on('error', fail);

        socket.on('message', (buf, rinfo) => {
            let parsed = null;
            try {
                parsed = JSON.parse(buf.toString());
            } catch (_) {
                return; // ignore malformed
            }
            const cid = normalizeMac(parsed && (parsed.cid || parsed.mac));
            if (cid && cid === target) {
                succeed(rinfo.address);
            }
        });

        socket.bind(() => {
            try {
                socket.setBroadcast(true);
            } catch (_) {
                /* may fail on non-broadcast interfaces; unicast still works */
            }
            const payload = Buffer.from(JSON.stringify({ t: 'scan' }));
            socket.send(
                payload,
                0,
                payload.length,
                port,
                broadcastAddress,
                sendErr => {
                    if (sendErr) {
                        fail(sendErr);
                        return;
                    }
                    timer = setTimeout(() => succeed(null), listenWindowMs);
                    if (typeof timer.unref === 'function') {
                        timer.unref();
                    }
                }
            );
        });
    });
}

/**
 * Periodically resolves a configured device MAC/cid to its current IP via
 * broadcast discovery, emitting `'resolved'` whenever the address first becomes
 * known or changes (DHCP churn). Decoupled from Node-RED so it can be unit
 * tested; the scan itself is injectable.
 *
 * Events:
 *   - 'resolved' (address, previousAddress)  the device's IP changed/appeared
 *   - 'miss'     ()                           a scan completed with no match
 *   - 'log'      (level, message, meta)
 */
class MacResolver extends EventEmitter {
    /**
     * @param {object} opts
     * @param {string} opts.mac                  device cid/MAC to track
     * @param {number} [opts.port]               discovery port (default 7000)
     * @param {string} [opts.broadcastAddress]   default 255.255.255.255
     * @param {number} [opts.intervalMs]         rescan period (min 5000, default 60000)
     * @param {number} [opts.listenWindowMs]     per-scan listen window (default 2000)
     * @param {string} [opts.initialAddress]     last-known IP, suppresses a redundant first 'resolved'
     * @param {Function} [opts.scan]             scan fn (DI for tests; default scanForMac)
     * @param {object} [opts.dgramModule]        dgram-like module forwarded to the default scan
     */
    constructor(opts = {}) {
        super();
        this.mac = opts.mac;
        this.port = opts.port || 7000;
        this.broadcastAddress = opts.broadcastAddress || '255.255.255.255';
        this.intervalMs = Math.max(5000, opts.intervalMs || 60000);
        this.listenWindowMs = Math.max(
            500,
            Math.min(30000, opts.listenWindowMs || 2000)
        );
        this.currentAddress = opts.initialAddress || null;
        this._scan = opts.scan || scanForMac;
        this._dgramModule = opts.dgramModule;
        this.timer = null;
        this.stopped = false;
        this._running = false;
    }

    /**
     * Begin resolving: one prompt scan, then every `intervalMs`.
     */
    start() {
        if (this.timer || this.stopped) {
            return;
        }
        this._tick();
        this.timer = setInterval(() => this._tick(), this.intervalMs);
        if (typeof this.timer.unref === 'function') {
            this.timer.unref();
        }
    }

    async _tick() {
        // Never overlap scans (a slow window must not stack up behind the timer).
        if (this._running || this.stopped) {
            return;
        }
        this._running = true;
        try {
            const addr = await this._scan({
                mac: this.mac,
                port: this.port,
                broadcastAddress: this.broadcastAddress,
                listenWindowMs: this.listenWindowMs,
                dgramModule: this._dgramModule,
            });
            if (this.stopped) {
                return;
            }
            if (!addr) {
                this.emit('miss');
                return;
            }
            if (addr !== this.currentAddress) {
                const from = this.currentAddress;
                this.currentAddress = addr;
                this.emit('resolved', addr, from);
            }
        } catch (err) {
            if (this.stopped) {
                return;
            }
            // A failed scan is non-fatal — log and try again next interval.
            this.emit('log', 'warn', 'MAC resolve scan failed', {
                mac: this.mac,
                error: err && err.message,
            });
        } finally {
            this._running = false;
        }
    }

    stop() {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

module.exports = { MacResolver, scanForMac, normalizeMac };
