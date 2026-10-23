'use strict';

const EventEmitter = require('events');
const {
    VENDOR_CODES,
    OPTIONAL_CODES,
    parseFeatures,
} = require('./transformer');

const OPTIONAL = new Set(OPTIONAL_CODES);

const DEFAULT_STATE = {
    Pow: 0,
    Mod: 0,
    TemUn: 0,
    SetTem: 24,
    TemSen: 65, // current temp; vendor encodes +40, so 25°C => 65
    WdSpd: 0,
    Air: 0,
    Blo: 1,
    Health: 0,
    SwhSlp: 0,
    SlpMod: 0, // sleep mode; moves in lockstep with SwhSlp (paired write)
    Lig: 0,
    SwingLfRig: 0,
    SwUpDn: 0,
    Quiet: 0,
    Tur: 0,
    SvSt: 0,
    StHt: 0,
    TemRec: 0, // °F setpoint disambiguation bit (SetTem stays °C)
    'Add0.5': 0, // half-degree bit of a °C setpoint
    // optional features (answered only when enabled, see `features`)
    AntiDirectBlow: 0,
    OutEnvTem: 58, // outdoor sensor, +40 like TemSen, so 18°C => 58
    DwatSen: 45, // indoor relative humidity %
    AllErr: 0, // fault code, 0 = no fault
    Dwet: 50, // target humidity %
    DwatFul: 0, // dehumidifier water tank full
    Dfltr: 0, // dehumidifier filter needs cleaning
    Dmod: 15, // humidity mode: 15 off, 0 target, 1 continuous, 2 smart
    LigSen: 1, // light sensor, inverted: 0 = on
};

class DeviceState extends EventEmitter {
    /**
     * @param {object} [initial] Vendor-keyed overrides for the default state.
     * @param {object} [options] Device options.
     * @param {number} [options.temSenOffset] Offset the device adds to the real
     *   internal temperature when encoding `TemSen`. Real Gree units use `40`
     *   (the documented +40 quirk). Some firmwares report `TemSen` already in
     *   real °C — model those with `0` to exercise the client's decode guard
     *   (inwaar/node-red-contrib-gree-hvac#10).
     * @param {string|string[]} [options.features] Optional features the unit
     *   has (friendly names or vendor codes, `all` or `none`); all by default.
     *   A status request for any other optional code is answered without it.
     */
    constructor(initial = {}, options = {}) {
        super();
        this._state = { ...DEFAULT_STATE, ...initial };
        this._temSenOffset =
            options.temSenOffset === undefined ? 40 : options.temSenOffset;
        this.features = parseFeatures(options.features);
        /**
         * Origin of the most recent state change, so consumers (the
         * dashboard) can tell apart changes driven by the Node-RED flow
         * over UDP from changes made directly on the dashboard.
         *
         * @type {{source: string, at: number, keys: string[]} | null}
         */
        this._lastChange = null;
    }

    get all() {
        return { ...this._state };
    }

    get lastChange() {
        return this._lastChange ? { ...this._lastChange } : null;
    }

    /**
     * Answer a status request: like a real unit, codes it does not know (or
     * optional features it lacks) are left out of the answer instead of being
     * reported as 0, so the client can tell which features exist.
     *
     * @param {string[]} cols requested vendor codes
     * @param {object} [extra] virtual columns (e.g. `time`, `name`, `hid`)
     * @returns {{cols: string[], dat: Array<number|string>}}
     */
    read(cols, extra = {}) {
        const out = { cols: [], dat: [] };
        for (const c of cols) {
            if (typeof c !== 'string') continue;
            let value;
            if (Object.prototype.hasOwnProperty.call(extra, c)) {
                value = extra[c];
            } else if (Object.prototype.hasOwnProperty.call(this._state, c)) {
                if (OPTIONAL.has(c) && !this.features.has(c)) continue;
                value = this._state[c];
            }
            if (value === undefined || value === null) continue;
            out.cols.push(c);
            out.dat.push(value);
        }
        return out;
    }

    /**
     * @param {string|string[]} features see the constructor
     */
    setFeatures(features) {
        this.features = parseFeatures(features);
        this.emit('change', {
            changed: {},
            state: { ...this._state },
            source: 'http',
            at: Date.now(),
        });
    }

    apply(opts, values, source = 'sim') {
        const changed = {};
        for (let i = 0; i < opts.length; i++) {
            const key = opts[i];
            // Keys arrive off the wire (Gree protocol opt[]). Accept only plain
            // property identifiers and reject prototype-polluting names, so the
            // dynamic writes below can't be driven by a crafted key.
            if (
                typeof key !== 'string' ||
                !/^[A-Za-z][A-Za-z0-9_.]*$/.test(key) ||
                key === 'constructor' ||
                key === 'prototype'
            ) {
                continue;
            }
            const val = values[i];
            if (!Object.prototype.hasOwnProperty.call(this._state, key)) {
                this._state[key] = val;
                changed[key] = val;
                continue;
            }
            if (this._state[key] !== val) {
                this._state[key] = val;
                changed[key] = val;
            }
        }
        if (Object.keys(changed).length) {
            this._lastChange = {
                source,
                at: Date.now(),
                keys: Object.keys(changed),
            };
            this.emit('change', {
                changed,
                state: { ...this._state },
                source,
                at: this._lastChange.at,
            });
        }
        return changed;
    }

    set(key, value, source = 'sim') {
        const vendorKey = VENDOR_CODES[key] || key;
        this.apply([vendorKey], [value], source);
    }

    setCurrentTemperature(celsius, source = 'sim') {
        this.apply(['TemSen'], [celsius + this._temSenOffset], source);
    }

    /**
     * The outdoor sensor (`OutEnvTem`) is offset by +40 like `TemSen`.
     *
     * @param {number} celsius
     * @param {string} [source]
     */
    setOutdoorTemperature(celsius, source = 'sim') {
        this.apply(['OutEnvTem'], [Math.round(celsius) + 40], source);
    }
}

module.exports = { DeviceState, DEFAULT_STATE };
