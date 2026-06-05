'use strict';

const VENDOR_CODES = {
    power: 'Pow',
    mode: 'Mod',
    temperatureUnit: 'TemUn',
    temperature: 'SetTem',
    currentTemperature: 'TemSen',
    fanSpeed: 'WdSpd',
    air: 'Air',
    blow: 'Blo',
    health: 'Health',
    sleep: 'SwhSlp',
    lights: 'Lig',
    swingHor: 'SwingLfRig',
    swingVert: 'SwUpDn',
    quiet: 'Quiet',
    turbo: 'Tur',
    powerSave: 'SvSt',
    safetyHeating: 'StHt',
};

const VENDOR_VALUE = {
    power: { off: 0, on: 1 },
    mode: { auto: 0, cool: 1, dry: 2, fan_only: 3, heat: 4 },
    temperatureUnit: { celsius: 0, fahrenheit: 1 },
    fanSpeed: {
        auto: 0,
        low: 1,
        mediumLow: 2,
        medium: 3,
        mediumHigh: 4,
        high: 5,
    },
    air: { off: 0, inside: 1, outside: 2, mode3: 3 },
    blow: { off: 0, on: 1 },
    health: { off: 0, on: 1 },
    sleep: { off: 0, on: 1 },
    lights: { off: 0, on: 1 },
    swingHor: {
        default: 0,
        full: 1,
        fixedLeft: 2,
        fixedMidLeft: 3,
        fixedMid: 4,
        fixedMidRight: 5,
        fixedRight: 6,
        fullAlt: 7,
    },
    swingVert: {
        default: 0,
        full: 1,
        fixedTop: 2,
        fixedMidTop: 3,
        fixedMid: 4,
        fixedMidBottom: 5,
        fixedBottom: 6,
        swingBottom: 7,
        swingMidBottom: 8,
        swingMid: 9,
        swingMidTop: 10,
        swingTop: 11,
    },
    quiet: { off: 0, mode1: 1, mode2: 2, mode3: 3 },
    turbo: { off: 0, on: 1 },
    powerSave: { off: 0, on: 1 },
    safetyHeating: { off: 0, on: 1 },
};

const reverseProps = Object.fromEntries(
    Object.entries(VENDOR_CODES).map(([k, v]) => [v, k])
);

const reverseValues = Object.fromEntries(
    Object.entries(VENDOR_VALUE).map(([prop, map]) => [
        prop,
        Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k])),
    ])
);

/**
 * @param vendorObj
 * @returns {{[key: string]: unknown}}
 */
function fromVendor(vendorObj) {
    const out = {};
    for (const [k, v] of Object.entries(vendorObj)) {
        const friendly = reverseProps[k] || k;
        const labels = reverseValues[friendly];
        out[friendly] = labels && labels[v] !== undefined ? labels[v] : v;
    }
    return out;
}

module.exports = {
    VENDOR_CODES,
    VENDOR_VALUE,
    reverseProps,
    reverseValues,
    fromVendor,
};
