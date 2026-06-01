'use strict';

const Gree = require('gree-hvac-client');

const KNOWN_PROPERTIES = new Set(Object.keys(Gree.PROPERTY));

const NUMERIC_PROPERTIES = new Set(['temperature', 'currentTemperature']);

/**
 * Validate a property map against the upstream PROPERTY / VALUE enums.
 *
 * Returns a normalised object with only the valid entries and a list of
 * warnings describing the entries that were rejected. The caller decides
 * whether to surface the warnings to Node-RED.
 *
 * Unknown properties are dropped (with a warning) because sending an
 * unknown key to the device confuses the WiFi module and can contribute
 * to wedging it. Known-enum properties whose value isn't in the enum are
 * also dropped. Numeric properties pass through any finite number.
 * @param {Object<string, unknown>} input
 * @returns {{ properties: Object<string, unknown>, warnings: string[] }}
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
        if (NUMERIC_PROPERTIES.has(key)) {
            const n = Number(value);
            if (!Number.isFinite(n)) {
                warnings.push(key + ': expected number, got ' + typeof value);
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
};
