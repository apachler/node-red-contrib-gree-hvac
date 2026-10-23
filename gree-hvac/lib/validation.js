'use strict';

const Gree = require('gree-hvac-client');

const KNOWN_PROPERTIES = new Set(Object.keys(Gree.PROPERTY));

// Properties without named values carry a number (setpoint, humidity, sensor
// readings, fault code).
const NUMERIC_PROPERTIES = new Set(
    [...KNOWN_PROPERTIES].filter(
        key => Object.keys(Gree.VALUE[key] || {}).length === 0
    )
);

// Reported by the device only; the client refuses to set them.
const READ_ONLY_PROPERTIES = new Set([
    'currentTemperature',
    'outdoorTemperature',
    'humidity',
    'errorCode',
    'waterFull',
    'cleanFilter',
]);

/**
 * Validate a property map against the upstream PROPERTY / VALUE enums.
 *
 * Returns a normalised object with only the valid entries and a list of
 * warnings describing the entries that were rejected. The caller decides
 * whether to surface the warnings to Node-RED.
 *
 * Unknown properties are dropped (with a warning) because sending an
 * unknown key to the device confuses the WiFi module and can contribute
 * to wedging it. Read-only properties and known-enum properties whose value
 * isn't in the enum are also dropped. Numeric properties pass through any
 * finite number (`targetHumidity`: a whole % from 0 to 100); the setpoint
 * range depends on the unit's temperature unit and is checked by the client.
 *
 * @param {{[key: string]: unknown}} input
 * @returns {{ properties: {[key: string]: unknown}, warnings: string[] }}
 */
function validateProperties(input) {
    const properties = {};
    const warnings = [];
    if (!input || typeof input !== 'object') {
        return { properties, warnings: ['payload is not an object'] };
    }
    for (const [key, value] of Object.entries(input)) {
        if (!KNOWN_PROPERTIES.has(key)) {
            warnings.push('unknown property: ' + key);
            continue;
        }
        if (READ_ONLY_PROPERTIES.has(key)) {
            warnings.push('read-only property: ' + key);
            continue;
        }
        if (NUMERIC_PROPERTIES.has(key)) {
            const n = Number(value);
            if (!Number.isFinite(n)) {
                warnings.push(key + ': expected number, got ' + typeof value);
                continue;
            }
            if (
                key === 'targetHumidity' &&
                (!Number.isInteger(n) || n < 0 || n > 100)
            ) {
                warnings.push(key + ': expected a whole % from 0 to 100');
                continue;
            }
            properties[key] = n;
            continue;
        }
        // enum-valued property
        const allowed = Gree.VALUE[key];
        if (allowed && typeof allowed === 'object') {
            const allowedValues = Object.values(allowed);
            if (allowedValues.length > 0 && !allowedValues.includes(value)) {
                warnings.push(
                    key +
                        ': value "' +
                        value +
                        '" not in [' +
                        allowedValues.join(', ') +
                        ']'
                );
                continue;
            }
        }
        properties[key] = value;
    }
    return { properties, warnings };
}

module.exports = {
    validateProperties,
    KNOWN_PROPERTIES,
    NUMERIC_PROPERTIES,
    READ_ONLY_PROPERTIES,
};
