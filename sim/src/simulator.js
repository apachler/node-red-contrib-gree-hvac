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
const DEFAULT_VERSION = 'V1.0.0';
// Firmware id (`hid` status column): firmware code + WiFi module + version.
// This code is not on the client's cloud-only list, so no upgrade warning.
const DEFAULT_HID = '362001000762+U-CS532AE(LT)V3.31.bin';
const MAX_NAME_LENGTH = 64;

class Simulator extends EventEmitter {
    constructor(opts = {}) {
        super();
        // ?? not ||: port 0 means "bind an ephemeral port" (the unit tests
        // rely on it) and must not silently become the fixed default.
        this.port = opts.port ?? 7000;
        this.bindAddress = opts.bindAddress || '0.0.0.0';
        this.cid = opts.cid || generateCid();
        this.name = opts.name || `gree-sim-${this.cid.slice(-4)}`;
        this.brand = opts.brand || DEFAULT_BRAND;
        this.model = opts.model || DEFAULT_MODEL;
        this.version = opts.version || DEFAULT_VERSION;
        // null/'' models a unit that does not report a firmware id
        this.hid = opts.hid === undefined ? DEFAULT_HID : opts.hid || null;
        this.cipherMode = opts.cipherMode || 'ecb'; // 'ecb' | 'gcm'
        this.verbose = opts.verbose || false; // log every protocol event
        this._deviceKey = opts.deviceKey || randomDeviceKey();
        const stateOptions = {
            temSenOffset: opts.temSenOffset,
            features: opts.features,
        };
        this._state =
            opts.state ||
            new DeviceState(opts.initialState || {}, stateOptions);
        // Multi-split: this unit is the outdoor unit's WiFi module (gateway)
        // and relays status/cmd to its indoor units, each with its own state.
        this._subUnits = new Map();
        for (const mac of subUnitMacs(opts.subUnits, this.cid)) {
            const state = new DeviceState({}, stateOptions);
            state.on('change', payload =>
                this.emit('state-change', { ...payload, unit: mac })
            );
            this._subUnits.set(mac, { mac, mid: '10001', state });
        }
        // The unit's clock, as an offset from this host's clock
        this._clockOffsetMs = 0;
        // Last WiFi setup (AP mode) request; the password is not kept
        this._wifi = null;
        // Beeper flags of the last command (per command, not device state)
        this._lastCommand = null;
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
            subLists: 0,
            wifiSetups: 0,
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
    /** @returns {Array<{mac: string, mid: string}>} indoor units (multi-split) */
    get subUnits() {
        return [...this._subUnits.values()].map(({ mac, mid }) => ({
            mac,
            mid,
        }));
    }
    /**
     * @param {string|null} [mac] indoor unit; the unit itself when empty/unknown
     * @returns {DeviceState}
     */
    unitState(mac) {
        const unit = mac && this._subUnits.get(String(mac));
        return unit ? unit.state : this._state;
    }
    get wifi() {
        return this._wifi ? { ...this._wifi } : null;
    }
    get lastCommand() {
        return this._lastCommand ? { ...this._lastCommand } : null;
    }

    /** @returns {string} the unit's clock, `YYYY-MM-DD HH:MM:SS` local time */
    get clock() {
        return formatTime(new Date(Date.now() + this._clockOffsetMs));
    }

    /**
     * @param {string|Date} time `YYYY-MM-DD HH:MM:SS` (local) or a Date
     * @param {string} [source]
     * @returns {boolean} true when the time was valid
     */
    setClock(time, source = 'sim') {
        const date = time instanceof Date ? time : parseTime(time);
        if (!date) return false;
        this._clockOffsetMs = date.getTime() - Date.now();
        this._emitIdentityChange({ time: this.clock }, source);
        return true;
    }

    /**
     * @param {string} name new device name (shown in scan answers)
     * @param {string} [source]
     * @returns {boolean} true when the name was valid
     */
    setName(name, source = 'sim') {
        const next = String(name ?? '')
            .trim()
            .slice(0, MAX_NAME_LENGTH);
        if (!next) return false;
        if (next !== this.name) {
            this.name = next;
            this._emitIdentityChange({ name: next }, source);
        }
        return true;
    }

    _emitIdentityChange(changed, source) {
        this.emit('state-change', {
            changed,
            state: this._state.all,
            source,
            at: Date.now(),
        });
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
            // No reuseAddr: UDP has no TIME_WAIT, so it buys nothing on
            // restart — but it lets a second sim (e.g. another test process)
            // bind the same port without EADDRINUSE, silently stealing that
            // port's packets. A port clash must fail loudly.
            const sock = dgram.createSocket('udp4');
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
                // reflect the actual port for port-0 (ephemeral) binds
                this.port = sock.address().port;
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

            // Unencrypted WiFi setup of a unit in AP mode
            if (msg.t === 'wlan') {
                this._stats.wifiSetups++;
                this._log('wlan     ←', `${rinfo.address}:${rinfo.port}`);
                return this._respondWifi(msg, rinfo);
            }

            // Classic multi-split unit list, generic key (AES-ECB modules)
            if (msg.t === 'subList' && msg.pack) {
                if (!this._decryptGeneric(msg)) return;
                this._stats.subLists++;
                this._log('subList  ←', `${rinfo.address}:${rinfo.port}`);
                return this._respondSubList(rinfo, true);
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
                if (inner.t === 'subList') {
                    this._stats.subLists++;
                    this._log('subList  ←', `${rinfo.address}:${rinfo.port}`);
                    return this._respondSubList(rinfo, false);
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

    _decryptGeneric(envelope) {
        try {
            return this.cipherMode === 'gcm'
                ? this._genericGcm.decrypt(envelope.pack, envelope.tag)
                : this._genericEcb.decrypt(envelope.pack);
        } catch (_) {
            this._stats.errors++;
            this.emit('protocol-error', { error: 'decrypt-failed' });
            return null;
        }
    }

    _sealGeneric(payload) {
        return this.cipherMode === 'gcm'
            ? this._genericGcm.encrypt(payload)
            : this._genericEcb.encrypt(payload);
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
            ver: this.version,
            vender: '1',
            lock: 0,
        };
        if (this._subUnits.size > 0) {
            innerPayload.subCnt = this._subUnits.size;
        }
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
        const requested = Array.isArray(inner.cols) ? inner.cols : [];
        // A multi-split gateway answers for the indoor unit named in `mac`
        const { cols, dat } = this.unitState(inner.mac).read(requested, {
            time: this.clock,
            name: this.name,
            hid: this.hid,
        });
        const payload = {
            t: 'dat',
            mac: inner.mac || this.cid,
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
        // The beeper flags, the clock and the name are not device state:
        // take them out before applying the rest to the addressed unit.
        const keys = [];
        const values = [];
        let silent = false;
        for (let i = 0; i < opts.length; i++) {
            const key = opts[i];
            const val = vals[i];
            if (key === 'Buzzer_ON_OFF') {
                silent = silent || val === 1; // older firmwares: 1 = silent
            } else if (key === 'BuzzerCtrl') {
                silent = silent || val === 0; // newer firmwares: 0 = silent
            } else if (key === 'time') {
                this.setClock(val, 'udp');
            } else if (key === 'name') {
                this.setName(val, 'udp');
            } else {
                keys.push(key);
                values.push(val);
            }
        }
        // `sub` names the indoor unit on a multi-split gateway; setClock()
        // sends the unit's own MAC there, which means the unit itself.
        const unit =
            inner.sub && this._subUnits.has(String(inner.sub))
                ? String(inner.sub)
                : null;
        this._lastCommand = { at: Date.now(), silent, unit };
        this.unitState(unit).apply(keys, values, 'udp');
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

    /**
     * Answer a subList request: the device-key form comes in a `pack`
     * envelope, the classic form (`generic`) with the generic key. A unit
     * that is no gateway answers with an empty list.
     *
     * @param {object} rinfo
     * @param {boolean} generic
     */
    _respondSubList(rinfo, generic) {
        const list = this.subUnits;
        const payload = {
            t: 'subList',
            mac: this.cid,
            r: 200,
            c: list.length,
            i: generic ? 1 : 0,
            list,
        };
        const sealed = generic
            ? this._sealGeneric(payload)
            : this._sealWithDeviceKey(payload);
        const envelope = {
            t: 'pack',
            i: generic ? 1 : 0,
            uid: 0,
            cid: this.cid,
            tcid: '',
            pack: sealed.pack,
        };
        if (sealed.tag) envelope.tag = sealed.tag;
        this._send(envelope, rinfo);
    }

    _respondWifi(msg, rinfo) {
        if (typeof msg.ssid !== 'string' || !msg.ssid) {
            this.emit('protocol-error', { error: 'wlan-without-ssid' });
            return;
        }
        this._wifi = { ssid: msg.ssid.slice(0, 64), at: Date.now() };
        this._emitIdentityChange({ wifi: this._wifi.ssid }, 'udp');
        // Answered unencrypted: there is no key in AP mode
        this._send({ t: 'ret', r: 200, mac: this.cid }, rinfo);
    }

    _sealWithDeviceKey(payload) {
        return this._deviceCipher instanceof GcmCipher
            ? this._deviceCipher.encrypt(payload)
            : this._deviceCipher.encrypt(payload);
    }
}

/**
 * @param {Date} date
 * @returns {string} `YYYY-MM-DD HH:MM:SS` in local time, as units report it
 */
function formatTime(date) {
    const pad = n => String(n).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
}

/**
 * @param {unknown} time `YYYY-MM-DD HH:MM:SS`, local time
 * @returns {Date|null}
 */
function parseTime(time) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
        String(time)
    );
    if (!m) return null;
    const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
    const date = new Date(y, mo - 1, d, h, mi, se);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Indoor-unit MACs of a multi-split gateway: a count (derived from the
 * gateway cid; indoor-unit MACs may be longer than 12 hex digits) or a
 * comma-separated list / array of MACs.
 *
 * @param {number|string|string[]|undefined} subUnits
 * @param {string} cid
 * @returns {string[]}
 */
function subUnitMacs(subUnits, cid) {
    if (subUnits === undefined || subUnits === null || subUnits === '') {
        return [];
    }
    if (Array.isArray(subUnits)) return subUnits.map(String);
    if (/^\d+$/.test(String(subUnits).trim())) {
        const n = Math.min(Number(subUnits), 16);
        return Array.from(
            { length: n },
            (_, i) => `${cid}${String(i + 1).padStart(2, '0')}`
        );
    }
    return String(subUnits)
        .split(',')
        .map(m => m.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * @returns {string} hex-encoded 6-byte mac-style id.
 */
function generateCid() {
    // 12 hex chars (mac-ish)
    const bytes = require('crypto').randomBytes(6);
    return bytes.toString('hex');
}

module.exports = { Simulator, formatTime, parseTime, subUnitMacs };
