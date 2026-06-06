'use strict';

const EventEmitter = require('events');
const { VENDOR_CODES } = require('./transformer');

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
     */
    constructor(initial = {}, options = {}) {
        super();
        this._state = { ...DEFAULT_STATE, ...initial };
        this._temSenOffset =
            options.temSenOffset === undefined ? 40 : options.temSenOffset;
        /**
         * Origin of the most recent state change, so consumers (the
         * dashboard) can tell apart changes driven by the Node-RED flow
         * over UDP from changes made directly on the dashboard.
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

    getCols(cols) {
        return cols.map(c =>
            this._state[c] !== undefined ? this._state[c] : 0
        );
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
                !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) ||
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
        const encoded = celsius + this._temSenOffset;
        if (this._state.TemSen !== encoded) {
            this._state.TemSen = encoded;
            this._lastChange = {
                source,
                at: Date.now(),
                keys: ['TemSen'],
            };
            this.emit('change', {
                changed: { TemSen: encoded },
                state: { ...this._state },
                source,
                at: this._lastChange.at,
            });
        }
    }
}

module.exports = { DeviceState, DEFAULT_STATE };
