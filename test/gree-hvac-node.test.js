'use strict';

// Node-level tests: the three contrib nodes constructed against a fake
// Node-RED runtime (test/helpers/fake-red.js), talking real UDP to the
// in-process simulator on an ephemeral port — no client mocks.

const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');

const { Simulator } = require('../sim/src/simulator');
const { createFakeRed, waitFor } = require('./helpers/fake-red');

const CID = 'a1b2c3d4e5f6';

const startSim = async () => {
    const sim = new Simulator({ port: 0, bindAddress: '127.0.0.1', cid: CID });
    await sim.start();
    return sim;
};

const portOf = sim => sim._socket.address().port;

// A UDP port nothing answers on: bind, read the port, close.
const deadPort = () =>
    new Promise(resolve => {
        const s = dgram.createSocket('udp4');
        s.bind(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });

const loadNodes = () => {
    const fake = createFakeRed();
    require('../gree-hvac/gree-hvac-config.js')(fake.RED);
    require('../gree-hvac/gree-hvac.js')(fake.RED);
    require('../gree-hvac/gree-hvac-discover.js')(fake.RED);
    return fake;
};

// Fast timings so the connection lifecycle runs in well under a second.
const FAST = {
    interval: 1,
    pollingTimeout: 2,
    connectTimeout: 2,
    recoveryDelay: 1,
    maxBackoff: 2,
    commandRate: 50,
    heartbeatInterval: 0,
};

const setup = async (t, nodeConfig = {}, deviceConfig = {}) => {
    const sim = await startSim();
    const fake = loadNodes();
    fake.create('gree-hvac-config', {
        id: 'dev',
        host: '127.0.0.1',
        port: portOf(sim),
        ...deviceConfig,
    });
    const node = fake.create('gree-hvac', {
        id: 'ac',
        device: 'dev',
        ...FAST,
        ...nodeConfig,
    });
    t.after(async () => {
        await fake.close(node);
        await sim.stop();
    });
    return { sim, fake, node };
};

const connected = node =>
    waitFor(
        () =>
            node.statuses.find(
                s => s.fill === 'green' && /^connected/.test(s.text)
            ),
        5000,
        'connected status'
    );

test('config node normalises its fields', () => {
    const fake = loadNodes();
    const dev = fake.create('gree-hvac-config', {
        id: 'c1',
        host: '10.0.0.5',
        port: '',
        resolveByMac: 'true',
        mac: '  AA:BB:CC:DD:EE:FF ',
        broadcastAddress: ' ',
        rediscoverInterval: 'x',
    });
    assert.equal(dev.host, '10.0.0.5');
    assert.equal(dev.port, 7000);
    assert.equal(dev.resolveByMac, true);
    assert.equal(dev.mac, 'AA:BB:CC:DD:EE:FF');
    assert.equal(dev.broadcastAddress, '255.255.255.255');
    assert.equal(dev.rediscoverInterval, 60);
});

test('gree-hvac without a usable device reports "no device"', () => {
    const fake = loadNodes();
    fake.create('gree-hvac-config', { id: 'empty', host: '' });
    const missing = fake.create('gree-hvac', { id: 'a', device: 'nope' });
    const noHost = fake.create('gree-hvac', { id: 'b', device: 'empty' });
    for (const n of [missing, noHost]) {
        assert.deepEqual(n.statuses.at(-1), {
            fill: 'red',
            shape: 'ring',
            text: 'no device',
        });
        assert.match(String(n.errors[0]), /missing a host/);
    }
});

test('connects, emits updates on outputs 1+2 and publishes metrics to context', async t => {
    const { node } = await setup(t);
    const status = await connected(node);
    assert.match(status.text, new RegExp(CID));

    const msg = await waitFor(
        () => node.sent.find(m => m[0] && m[0].topic === 'updated'),
        5000,
        'updated output'
    );
    assert.equal(msg[1].topic, 'properties');
    assert.equal(msg[1].payload.power, 'off');
    assert.equal(msg[2], null);

    const metrics = node.context().get('gree');
    assert.equal(metrics.state, 'connected');
});

test('payload object is validated, sent to the device and acknowledged', async t => {
    const { sim, fake, node } = await setup(t);
    await connected(node);

    const { err } = await fake.input(node, {
        payload: { power: 'on', temperature: 21, bogus: 1 },
    });
    assert.equal(err, undefined);
    assert.ok(node.warnings.some(w => /unknown property: bogus/.test(w)));

    await waitFor(() => sim.state.all.Pow === 1, 5000, 'sim power on');
    assert.equal(sim.state.all.SetTem, 21);
    const ack = await waitFor(
        () => node.sent.find(m => m[0] && m[0].topic === 'acknowledged'),
        5000,
        'acknowledged output'
    );
    assert.equal(ack[0].payload.power, 'on');
});

test('topic form (msg.topic = property) sets a single property', async t => {
    const { sim, fake, node } = await setup(t);
    await connected(node);
    const { err } = await fake.input(node, { topic: 'mode', payload: 'cool' });
    assert.equal(err, undefined);
    await waitFor(() => sim.state.all.Mod === 1, 5000, 'sim mode cool');
});

test('rejects input that is neither an object payload nor a topic', async t => {
    const { fake, node } = await setup(t);
    const { err } = await fake.input(node, { payload: 'on' });
    assert.match(err.message, /expected payload object or msg.topic/);
});

test('rejects a payload with no valid properties when validation is on', async t => {
    const { fake, node } = await setup(t);
    const { err } = await fake.input(node, {
        payload: { power: 'sideways', nope: 1 },
    });
    assert.match(err.message, /No valid properties to send/);
});

test('rejectIfOffline refuses commands while disconnected', async t => {
    const { fake, node } = await setup(
        t,
        { rejectIfOffline: true },
        { port: await deadPort() }
    );
    const { err } = await fake.input(node, { payload: { power: 'on' } });
    assert.match(err.message, /Command rejected/);
});

test('an unreachable device leaves the connected state and retries', async t => {
    const { node } = await setup(t, {}, { port: await deadPort() });
    await waitFor(
        () =>
            node.statuses.some(
                s =>
                    s.fill === 'red' ||
                    /reconnect|no response/.test(s.text || '')
            ),
        8000,
        'failure / reconnect status'
    );
    assert.ok(!node.statuses.some(s => s.fill === 'green'));
});

test('heartbeat diagnostics go to output 3; debug forwards manager logs', async t => {
    const { node } = await setup(t, { heartbeatInterval: 1, debug: true });
    await connected(node);
    const hb = await waitFor(
        () =>
            node.sent.find(
                m => m[2] && m[2].payload && m[2].payload.event === 'heartbeat'
            ),
        3000,
        'heartbeat diagnostic'
    );
    assert.equal(hb[2].topic, 'diagnostic');
    assert.equal(hb[0], null);
    assert.ok(node.logs.length + node.warnings.length > 0);
});

test('resolve-by-MAC finds the device and connects without a host', async t => {
    const { node } = await setup(
        t,
        { debug: true },
        {
            host: '',
            resolveByMac: true,
            mac: CID,
            broadcastAddress: '127.0.0.1',
            rediscoverInterval: 5,
        }
    );
    await connected(node);
    assert.ok(
        node.logs.some(l => new RegExp(`Resolved ${CID} -> 127.0.0.1`).test(l))
    );
});

test('close stops the manager and reports "stopped"', async () => {
    const sim = await startSim();
    try {
        const fake = loadNodes();
        fake.create('gree-hvac-config', {
            id: 'dev',
            host: '127.0.0.1',
            port: portOf(sim),
        });
        const node = fake.create('gree-hvac', {
            id: 'ac',
            device: 'dev',
            ...FAST,
            heartbeatInterval: 60,
        });
        await connected(node);
        await fake.close(node);
        assert.equal(node.statuses.at(-1).text, 'stopped');
    } finally {
        await sim.stop();
    }
});

test('discover node finds the simulator and rejects overlapping scans', async t => {
    const sim = await startSim();
    const fake = loadNodes();
    const node = fake.create('gree-hvac-discover', {
        id: 'disc',
        broadcastAddress: '127.0.0.1',
        port: portOf(sim),
        listenWindowMs: 500,
    });
    t.after(async () => {
        await fake.close(node);
        await sim.stop();
    });

    const first = fake.input(node, { windowMs: 500 });
    const overlap = await fake.input(node, {});
    assert.match(overlap.err.message, /already in progress/);

    const { err, sent } = await first;
    assert.equal(err, undefined);
    assert.equal(sent[0].topic, 'gree-discovery');
    assert.ok(
        sent[0].payload.some(d => d.cid === CID && d.port === portOf(sim))
    );
    assert.equal(node.statuses.at(-1).text, `found ${sent[0].payload.length}`);
});

test('discover node reports send errors', async t => {
    const fake = loadNodes();
    const node = fake.create('gree-hvac-discover', { id: 'disc2' });
    t.after(() => fake.close(node));
    const { err } = await fake.input(node, {
        broadcastAddress: 'not-a-host.invalid',
    });
    assert.ok(err instanceof Error);
    assert.equal(node.statuses.at(-1).fill, 'red');
});
