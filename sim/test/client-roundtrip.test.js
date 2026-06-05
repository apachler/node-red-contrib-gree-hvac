'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Simulator } = require('../src/simulator');
const Gree = require('gree-hvac-client');

const startSim = async opts => {
    const sim = new Simulator({ port: 0, ...opts });
    await sim.start();
    return sim;
};

const portOf = sim => sim._socket.address().port;

const onceWithTimeout = (emitter, event, ms) =>
    new Promise((resolve, reject) => {
        const t = setTimeout(
            () => reject(new Error(`timed out waiting for "${event}"`)),
            ms
        );
        emitter.once(event, payload => {
            clearTimeout(t);
            resolve(payload);
        });
    });

test('real gree-hvac-client can connect, bind, status, and set against simulator', async t => {
    const sim = await startSim({ cid: '112233aabbcc' });

    const client = new Gree.Client({
        host: '127.0.0.1',
        port: portOf(sim),
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
        await sim.stop();
    });

    const connected = onceWithTimeout(client, 'connect', 4000);
    await client.connect();
    await connected;

    assert.equal(client.getDeviceId(), '112233aabbcc');

    const updated = onceWithTimeout(client, 'update', 4000);
    const initial = await updated;
    assert.equal(initial.power, 'off');
    assert.equal(initial.mode, 'auto');
    assert.equal(initial.temperature, 24);

    const success = onceWithTimeout(client, 'success', 4000);
    await client.setProperties({
        power: 'on',
        mode: 'cool',
        temperature: 21,
        fanSpeed: 'high',
    });
    const successResult = await success;
    assert.equal(successResult.power, 'on');
    assert.equal(successResult.mode, 'cool');
    assert.equal(successResult.temperature, 21);

    // sim state reflects the changes
    assert.equal(sim.state.all.Pow, 1);
    assert.equal(sim.state.all.Mod, 1);
    assert.equal(sim.state.all.SetTem, 21);
    assert.equal(sim.state.all.WdSpd, 5);
});
