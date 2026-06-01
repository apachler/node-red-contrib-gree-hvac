'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');

const { ensureStack, teardownStack } = require('./global-setup');
const { get, postJson } = require('./harness');
const Gree = require('gree-hvac-client');

test.before(async () => {
    await ensureStack({ skipBuild: process.env.E2E_SKIP_BUILD === '1' });
});

test.after(async () => {
    if (process.env.E2E_KEEP_UP === '1') return;
    await teardownStack();
});

test('sim dashboard is reachable', async () => {
    const r = await get('http://127.0.0.1:8080/api/state');
    assert.equal(r.status, 200);
    const state = JSON.parse(r.body);
    assert.ok(state.cid);
    assert.ok(state.friendly);
    assert.equal(state.cipher, 'ecb');
});

test('sim exposes mock sensors and accepts updates', async () => {
    const r = await get('http://127.0.0.1:8080/api/sensors');
    assert.equal(r.status, 200);
    const before = JSON.parse(r.body);
    assert.ok(typeof before.soc === 'number');

    const upd = await postJson('http://127.0.0.1:8080/api/sensors', {
        soc: 42,
        insideC: 27.5,
    });
    assert.equal(upd.status, 200);
    const after = JSON.parse(upd.body);
    assert.equal(after.soc, 42);
    assert.equal(after.insideC, 27.5);
});

test('gree-hvac-client can drive the sim end-to-end over UDP', async t => {
    const client = new Gree.Client({
        host: '127.0.0.1',
        port: 7000,
        autoConnect: false,
        poll: false,
        connectTimeout: 4000,
        pollingTimeout: 4000,
    });

    t.after(async () => {
        try {
            await client.disconnect();
        } catch (_) {
            /* already disconnected */
        }
    });

    const connected = onceWithTimeout(client, 'connect', 6000);
    await client.connect();
    await connected;

    const update = onceWithTimeout(client, 'update', 6000);
    const initial = await update;
    assert.ok(initial);
    assert.ok(['off', 'on'].includes(initial.power));

    const success = onceWithTimeout(client, 'success', 6000);
    await client.setProperties({
        power: 'on',
        mode: 'cool',
        temperature: 20,
        fanSpeed: 'medium',
    });
    const result = await success;
    assert.equal(result.power, 'on');
    assert.equal(result.mode, 'cool');
    assert.equal(result.temperature, 20);

    // The dashboard should now reflect the same state
    const r = await get('http://127.0.0.1:8080/api/state');
    const state = JSON.parse(r.body);
    assert.equal(state.friendly.power, 'on');
    assert.equal(state.friendly.mode, 'cool');
    assert.equal(state.friendly.temperature, 20);
});

/**
 * @param emitter
 * @param event
 * @param ms
 * @returns {Promise<any>}
 */
function onceWithTimeout(emitter, event, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(
            () => reject(new Error(`timed out waiting for "${event}"`)),
            ms
        );
        emitter.once(event, payload => {
            clearTimeout(t);
            resolve(payload);
        });
    });
}

void dgram; // imported for protocol parity references; not used in this file
