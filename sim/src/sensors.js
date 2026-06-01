'use strict';

const EventEmitter = require('events');

const DEFAULTS = {
    soc: 78,
    batteryVoltage: 53.7,
    batterySystemStateNum: 1, // 0=idle, 1=charging, 2=discharging
    insideC: 24.5,
    outsideC: 22.0,
};

class MockSensors extends EventEmitter {
    constructor(initial = {}) {
        super();
        this._state = { ...DEFAULTS, ...initial };
    }

    snapshot() {
        return { ...this._state };
    }

    update(patch) {
        const changed = {};
        for (const [k, v] of Object.entries(patch || {})) {
            if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
            const num = Number(v);
            if (!Number.isFinite(num)) continue;
            if (this._state[k] !== num) {
                this._state[k] = num;
                changed[k] = num;
            }
        }
        if (Object.keys(changed).length) {
            this.emit('change', { changed, state: { ...this._state } });
        }
        return changed;
    }
}

module.exports = { MockSensors, DEFAULTS };
