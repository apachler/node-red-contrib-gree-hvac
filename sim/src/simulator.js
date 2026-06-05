'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');

const {
    EcbCipher,
    GcmCipher,
    randomDeviceKey,
    ECB_GENERIC_KEY,
} = require('./cipher');
const { DeviceState } = require('./state');
const { FaultInjector } = require('./fault-injection');

const DEFAULT_BRAND = 'gree';
const DEFAULT_MODEL = 'sim-1.0';

class Simulator extends EventEmitter {
    constructor(opts = {}) {
        super();
        this.port = opts.port || 7000;
        this.bindAddress = opts.bindAddress || '0.0.0.0';
        this.cid = opts.cid || generateCid();
        this.name = opts.name || `gree-sim-${this.cid.slice(-4)}`;
        this.brand = opts.brand || DEFAULT_BRAND;
        this.model = opts.model || DEFAULT_MODEL;
        this.cipherMode = opts.cipherMode || 'ecb'; // 'ecb' | 'gcm'
        this.verbose = opts.verbose || false; // log every protocol event
        this._deviceKey = opts.deviceKey || randomDeviceKey();
        this._state = opts.state || new DeviceState(opts.initialState || {});
        this._faults = new FaultInjector(opts.faults || {});

        this._genericEcb = new EcbCipher(ECB_GENERIC_KEY);
        this._genericGcm = new GcmCipher();
        this._deviceCipher =
            this.cipherMode === 'gcm'
                ? new GcmCipher(this._deviceKey)
                : new EcbCipher(this._deviceKey);

        this._socket = null;
        this._stats = {
            packetsRx: 0,
            packetsTx: 0,
            packetsDropped: 0,
            scans: 0,
            binds: 0,
            statusRequests: 0,
            commands: 0,
            errors: 0,
        };
        this._startedAt = Date.now();
        this._lastActivityAt = null;

        this._state.on('change', payload => this.emit('state-change', payload));
    }

    _log(...args) {
        if (this.verbose) {
            console.log('[sim]', ...args);
        }
    }

    get state() {
        return this._state;
    }
    get faults() {
        return this._faults;
    }
    get stats() {
        const out = this._stats.packetsTx + this._stats.packetsDropped;
        return {
            ...this._stats,
            dropRate:
                out > 0
                    ? +((this._stats.packetsDropped / out) * 100).toFixed(1)
                    : 0,
            uptimeSeconds: Math.round((Date.now() - this._startedAt) / 1000),
            lastActivityAt: this._lastActivityAt,
        };
    }

    resetStats() {
        for (const k of Object.keys(this._stats)) this._stats[k] = 0;
        this._startedAt = Date.now();
        this._lastActivityAt = null;
    }
    get deviceKey() {
        return this._deviceKey;
    }

    start() {
        return new Promise((resolve, reject) => {
            const sock = dgram.createSocket({
                type: 'udp4',
                reuseAddr: true,
            });
            sock.on('error', err => {
                this._stats.errors++;
                this.emit('error', err);
                reject(err);
            });
            sock.on('message', (msg, rinfo) => this._onMessage(msg, rinfo));
            sock.bind(this.port, this.bindAddress, () => {
                try {
                    sock.setBroadcast(true);
                } catch (_) {
                    /* may fail on non-broadcast interfaces; ignore */
                }
                this._socket = sock;
                this.emit('listening', {
                    address: this.bindAddress,
                    port: this.port,
                });
                resolve();
            });
        });
    }

    stop() {
        return new Promise(resolve => {
            if (!this._socket) return resolve();
            const sock = this._socket;
            this._socket = null;
            sock.close(() => resolve());
        });
    }

    _onMessage(buf, rinfo) {
        this._stats.packetsRx++;
        this._lastActivityAt = Date.now();
        let msg;
        try {
            msg = JSON.parse(buf.toString('utf8'));
        } catch (e) {
            this._stats.errors++;
            this.emit('protocol-error', { error: 'parse', detail: e.message });
            return;
        }

        try {
            // Unencrypted discovery probe
            if (msg.t === 'scan') {
                this._stats.scans++;
                this._log('discover ←', `${rinfo.address}:${rinfo.port}`);
                return this._respondScan(rinfo);
            }

            if (msg.t === 'pack' && msg.pack) {
                const inner = this._decryptInbound(msg);
                if (!inner) return;

                if (inner.t === 'bind') {
                    this._stats.binds++;
                    this._log(
                        'bind     ←',
                        `${rinfo.address}:${rinfo.port}`,
                        '→ issuing device key'
                    );
                    return this._respondBind(inner, rinfo);
                }
                if (inner.t === 'status') {
                    this._stats.statusRequests++;
                    this._log(
                        'status   ←',
                        `${rinfo.address}:${rinfo.port}`,
                        `cols=${(inner.cols || []).length}`
                    );
                    return this._respondStatus(inner, rinfo);
                }
                if (inner.t === 'cmd') {
                    this._stats.commands++;
                    this._log(
                        'cmd      ←',
                        `${rinfo.address}:${rinfo.port}`,
                        `opt=${JSON.stringify(inner.opt)} val=${JSON.stringify(
                            inner.p
                        )}`
                    );
                    return this._respondCmd(inner, rinfo);
                }
                this.emit('protocol-error', {
                    error: 'unknown-inner',
                    inner,
                });
                return;
            }

            this.emit('protocol-error', { error: 'unknown-envelope', msg });
        } catch (err) {
            this._stats.errors++;
            this.emit('protocol-error', {
                error: 'handler',
                detail: err.message,
            });
        }
    }

    _decryptInbound(envelope) {
        // Try device cipher first if bound; fall back to generic ciphers
        const candidates = [
            this._deviceCipher,
            this.cipherMode === 'gcm' ? this._genericGcm : this._genericEcb,
        ];
        for (const c of candidates) {
            try {
                if (c instanceof GcmCipher) {
                    return c.decrypt(envelope.pack, envelope.tag);
                }
                return c.decrypt(envelope.pack);
            } catch (_) {
                /* try next */
            }
        }
        this._stats.errors++;
        this.emit('protocol-error', { error: 'decrypt-failed' });
        return null;
    }

    _send(envelope, rinfo) {
        if (this._faults.shouldDrop()) {
            this._stats.packetsDropped++;
            this._log('drop     ✗ response withheld (fault injection)');
            this.emit('packet-dropped', { envelope, rinfo });
            return;
        }
        const buf = Buffer.from(JSON.stringify(envelope));
        const delay = this._faults.delay();
        const doSend = () => {
            if (!this._socket) return;
            this._socket.send(
                buf,
                0,
                buf.length,
                rinfo.port,
                rinfo.address,
                err => {
                    if (err) {
                        this._stats.errors++;
                        this.emit('error', err);
                    } else {
                        this._stats.packetsTx++;
                    }
                }
            );
        };
        if (delay) setTimeout(doSend, delay);
        else doSend();
    }

    _respondScan(rinfo) {
        const innerPayload = {
            t: 'dev',
            cid: this.cid,
            bc: this.brand,
            brand: this.brand,
            catalog: 'gree',
            mac: this.cid,
            mid: '10001',
            model: this.model,
            name: this.name,
            series: 'gree',
            ver: 'V1.0.0',
            vender: '1',
            lock: 0,
        };
        const sealed =
            this.cipherMode === 'gcm'
                ? this._genericGcm.encrypt(innerPayload)
                : this._genericEcb.encrypt(innerPayload);
        const envelope = {
            t: 'pack',
            i: 1,
            uid: 0,
            cid: this.cid,
            tcid: '',
            pack: sealed.pack,
        };
        if (sealed.tag) envelope.tag = sealed.tag;
        this._send(envelope, rinfo);
    }

    _respondBind(inner, rinfo) {
        const payload = {
            t: 'bindok',
            mac: this.cid,
            key: this._deviceKey,
            r: 200,
        };
        // bindok must be encrypted with the *generic* key (per protocol — client
        // hasn't seen the device key yet); only after bindok does the client
        // switch to the device key for subsequent traffic.
        const sealed =
            this.cipherMode === 'gcm'
                ? this._genericGcm.encrypt(payload)
                : this._genericEcb.encrypt(payload);
        const envelope = {
            t: 'pack',
            i: 1,
            uid: 0,
            cid: this.cid,
            tcid: inner.mac || this.cid,
            pack: sealed.pack,
        };
        if (sealed.tag) envelope.tag = sealed.tag;
        this._send(envelope, rinfo);
    }

    _respondStatus(inner, rinfo) {
        const cols = Array.isArray(inner.cols) ? inner.cols : [];
        const dat = this._state.getCols(cols);
        const payload = {
            t: 'dat',
            mac: this.cid,
            cid: this.cid,
            r: 200,
            cols,
            dat,
        };
        const sealed = this._sealWithDeviceKey(payload);
        const envelope = {
            t: 'pack',
            i: 0,
            uid: 0,
            cid: this.cid,
            tcid: this.cid,
            pack: sealed.pack,
        };
        if (sealed.tag) envelope.tag = sealed.tag;
        this._send(envelope, rinfo);
    }

    _respondCmd(inner, rinfo) {
        const opts = Array.isArray(inner.opt) ? inner.opt : [];
        const vals = Array.isArray(inner.p) ? inner.p : [];
        // A 'cmd' arrives over the Gree UDP protocol from any client (the
        // Node-RED flow's gree-hvac node, gree-hvac-client, or a real app).
        // Tag the change as protocol-driven so the dashboard can tell it
        // apart from a direct action taken on the dashboard itself.
        this._state.apply(opts, vals, 'udp');
        const payload = {
            t: 'res',
            mac: this.cid,
            cid: this.cid,
            r: 200,
            opt: opts,
            val: vals,
            p: vals,
        };
        const sealed = this._sealWithDeviceKey(payload);
        const envelope = {
            t: 'pack',
            i: 0,
            uid: 0,
            cid: this.cid,
            tcid: this.cid,
            pack: sealed.pack,
        };
        if (sealed.tag) envelope.tag = sealed.tag;
        this._send(envelope, rinfo);
    }

    _sealWithDeviceKey(payload) {
        return this._deviceCipher instanceof GcmCipher
            ? this._deviceCipher.encrypt(payload)
            : this._deviceCipher.encrypt(payload);
    }
}

/**
 * @returns {string} hex-encoded 6-byte mac-style id.
 */
function generateCid() {
    // 12 hex chars (mac-ish)
    const bytes = require('crypto').randomBytes(6);
    return bytes.toString('hex');
}

module.exports = { Simulator };
