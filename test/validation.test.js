'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { validateProperties } = require('../gree-hvac/lib/validation');

test('drops unknown properties with a warning', () => {
    const { properties, warnings } = validateProperties({
        power: 'on',
        bogus: 1,
    });
    assert.deepEqual(properties, { power: 'on' });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown property: bogus/);
});

test('rejects values outside an enum', () => {
    const { properties, warnings } = validateProperties({
        power: 'maybe',
    });
    assert.deepEqual(properties, {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /power/);
});

test('passes numeric properties through after coercion', () => {
    const { properties, warnings } = validateProperties({
        temperature: '23',
    });
    assert.deepEqual(properties, { temperature: 23 });
    assert.equal(warnings.length, 0);
});

test('rejects non-numeric value for a numeric property', () => {
    const { properties, warnings } = validateProperties({
        temperature: 'hot',
    });
    assert.deepEqual(properties, {});
    assert.equal(warnings.length, 1);
});

test('returns an empty result for non-object input', () => {
    const { properties, warnings } = validateProperties(null);
    assert.deepEqual(properties, {});
    assert.equal(warnings.length, 1);
});
