'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    MacResolver,
    scanForMac,
    normalizeMac,
} = require('../gree-hvac/lib/mac-resolver');
const { Simulator } = require('../sim/src/simulator');

const startSim = async opts => {
    const sim = new Simulator({ port: 0, ...opts });
    await sim.start();
    return sim;
};
const portOf = sim => sim._socket.address().port;

const tick = ms => new Promise(r => setTimeout(r, ms));

test('normalizeMac strips separators and lower-cases', () => {
    assert.equal(normalizeMac('AA:BB:CC:DD:EE:FF'), 'aabbccddeeff');
    assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'aabbccddeeff');
    assert.equal(normalizeMac('AABBCCDDEEFF'), 'aabbccddeeff');
    assert.equal(normalizeMac(''), '');
    assert.equal(normalizeMac(null), '');
});

test('scanForMac resolves the IP of a matching device via discovery', async t => {
    const sim = await startSim({ cid: '112233aabbcc' });
    t.after(async () => sim.stop());

    const addr = await scanForMac({
        mac: '11:22:33:AA:BB:CC', // separators + case must still match
        port: portOf(sim),
        broadcastAddress: '127.0.0.1',
        listenWindowMs: 1500,
    });

    assert.equal(addr, '127.0.0.1');
});

test('scanForMac resolves to null when no device matches in the window', async t => {
    const sim = await startSim({ cid: '112233aabbcc' });
    t.after(async () => sim.stop());

    const addr = await scanForMac({
        mac: 'ffffffffffff', // not this device
        port: portOf(sim),
        broadcastAddress: '127.0.0.1',
        listenWindowMs: 600,
    });

    assert.equal(addr, null);
});

test('scanForMac resolves to null for an empty MAC without sending', async () => {
    const addr = await scanForMac({ mac: '', listenWindowMs: 100 });
    assert.equal(addr, null);
});

test('MacResolver emits resolved on first discovery and on IP change only', async () => {
    const queue = ['10.0.0.5', '10.0.0.5', '10.0.0.9'];
    const resolver = new MacResolver({
        mac: 'aabbccddeeff',
        scan: async () => queue.shift(),
    });
    const events = [];
    resolver.on('resolved', (addr, from) => events.push([addr, from]));

    await resolver._tick(); // -> 10.0.0.5 (new)
    await resolver._tick(); // -> 10.0.0.5 (unchanged, no event)
    await resolver._tick(); // -> 10.0.0.9 (changed)

    assert.deepEqual(events, [
        ['10.0.0.5', null],
        ['10.0.0.9', '10.0.0.5'],
    ]);
});

test('MacResolver respects initialAddress (no redundant first resolved)', async () => {
    const resolver = new MacResolver({
        mac: 'aabbccddeeff',
        initialAddress: '10.0.0.5',
        scan: async () => '10.0.0.5',
    });
    let fired = 0;
    resolver.on('resolved', () => (fired += 1));

    await resolver._tick();
    assert.equal(fired, 0);

    resolver._scan = async () => '10.0.0.6';
    await resolver._tick();
    assert.equal(fired, 1);
});

test('MacResolver emits miss when a scan finds nothing', async () => {
    const resolver = new MacResolver({
        mac: 'aabbccddeeff',
        scan: async () => null,
    });
    let missed = 0;
    let resolved = 0;
    resolver.on('miss', () => (missed += 1));
    resolver.on('resolved', () => (resolved += 1));

    await resolver._tick();
    assert.equal(missed, 1);
    assert.equal(resolved, 0);
});

test('MacResolver absorbs scan failures (logs, never throws)', async () => {
    const resolver = new MacResolver({
        mac: 'aabbccddeeff',
        scan: async () => {
            throw new Error('socket boom');
        },
    });
    const logs = [];
    resolver.on('log', (level, message) => logs.push([level, message]));

    await assert.doesNotReject(() => resolver._tick());
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], 'warn');
});

test('MacResolver.start schedules a prompt first scan and stop() halts it', async () => {
    let calls = 0;
    const resolver = new MacResolver({
        mac: 'aabbccddeeff',
        intervalMs: 5000,
        scan: async () => {
            calls += 1;
            return '10.0.0.5';
        },
    });
    const resolved = new Promise(res => resolver.on('resolved', res));
    resolver.start();
    await resolved;
    resolver.stop();
    const after = calls;
    await tick(20);
    assert.equal(calls, after); // no further scans after stop
});
