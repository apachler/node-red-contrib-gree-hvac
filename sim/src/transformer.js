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
    antiDirectBlow: 'AntiDirectBlow',
    outdoorTemperature: 'OutEnvTem',
    humidity: 'DwatSen',
    errorCode: 'AllErr',
    targetHumidity: 'Dwet',
    waterFull: 'DwatFul',
    cleanFilter: 'Dfltr',
    humidityMode: 'Dmod',
    lightSensor: 'LigSen',
};

/**
 * Vendor codes only some units have (gree-hvac-client's OPTIONAL_VENDOR_CODES).
 * A unit without the feature answers a status request for one with an empty
 * `dat`, so the client probes each once after binding and polls only those
 * it got a value for.
 */
const OPTIONAL_CODES = [
    'AntiDirectBlow',
    'OutEnvTem',
    'DwatSen',
    'AllErr',
    'Dwet',
    'DwatFul',
    'Dfltr',
    'Dmod',
    'LigSen',
];

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
    antiDirectBlow: { off: 0, on: 1 },
    waterFull: { off: 0, on: 1 },
    cleanFilter: { off: 0, on: 1 },
    humidityMode: { off: 15, target: 0, continuous: 1, smart: 2 },
    // LigSen is inverted: 0 means the sensor is active
    lightSensor: { off: 1, on: 0 },
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

/**
 * Map the configured features (friendly names or vendor codes, `all`/`none`)
 * to the set of optional vendor codes the simulated unit answers.
 *
 * @param {string|string[]|undefined} features
 * @returns {Set<string>}
 */
function parseFeatures(features) {
    if (features === undefined || features === null || features === '') {
        return new Set(OPTIONAL_CODES);
    }
    const list = Array.isArray(features)
        ? features
        : String(features)
              .split(',')
              .map(f => f.trim())
              .filter(Boolean);
    if (list.length === 1 && /^all$/i.test(list[0])) {
        return new Set(OPTIONAL_CODES);
    }
    const codes = new Set();
    for (const f of list) {
        const code = VENDOR_CODES[f] || f;
        if (OPTIONAL_CODES.includes(code)) codes.add(code);
    }
    return codes;
}

/**
 * The setpoint as the unit shows it: `SetTem` is always °C on the wire; in
 * °F the `TemRec` bit tells apart the two °F values that round to one °C
 * (same formula as gree-hvac-client), in °C `Add0.5` adds a half degree.
 *
 * @param {object} raw vendor state
 * @returns {{value: number|null, unit: string}}
 */
function displaySetpoint(raw) {
    const setTem = raw.SetTem;
    if (typeof setTem !== 'number') return { value: null, unit: '°C' };
    if (raw.TemUn === 1) {
        if (setTem > 40) return { value: setTem, unit: '°F' };
        const encode = f => {
            const c = ((f - 32) * 5) / 9;
            const rounded = Math.round(c);
            return { SetTem: rounded, TemRec: c - rounded > 0 ? 1 : 0 };
        };
        const approx = (setTem * 9) / 5 + 32;
        for (let f = Math.floor(approx) - 1; f <= Math.ceil(approx) + 1; f++) {
            const e = encode(f);
            if (e.SetTem === setTem && e.TemRec === (raw.TemRec ? 1 : 0)) {
                return { value: f, unit: '°F' };
            }
        }
        return { value: Math.round(approx), unit: '°F' };
    }
    return { value: setTem + (raw['Add0.5'] === 1 ? 0.5 : 0), unit: '°C' };
}

module.exports = {
    VENDOR_CODES,
    OPTIONAL_CODES,
    parseFeatures,
    displaySetpoint,
    VENDOR_VALUE,
    reverseProps,
    reverseValues,
    fromVendor,
};
