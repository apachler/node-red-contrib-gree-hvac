'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');

const { Simulator } = require('../src/simulator');
const { DeviceState } = require('../src/state');
const { EcbCipher } = require('../src/cipher');

const startEphemeralSim = async (opts = {}) => {
    const sim = new Simulator({ port: 0, ...opts });
    await sim.start();
    return sim;
};

const portOf = sim => sim._socket.address().port;

const sendJson = (sock, msg, port) =>
    new Promise((resolve, reject) => {
        const buf = Buffer.from(JSON.stringify(msg));
        sock.send(buf, 0, buf.length, port, '127.0.0.1', err => {
            if (err) reject(err);
            else resolve();
        });
    });

const waitForMessage = sock =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('timed out waiting for response')),
            1500
        );
        sock.once('message', buf => {
            clearTimeout(timer);
            resolve(JSON.parse(buf.toString('utf8')));
        });
    });

// Regression: `opts.port || 7000` turned the ephemeral `port: 0` into the
// fixed default, so every sim in every test process bound 7000 (silently,
// via reuseAddr) and parallel test files stole each other's packets.
test('port 0 binds a real ephemeral port, distinct per sim', async () => {
    const a = await startEphemeralSim();
    const b = await startEphemeralSim();
    try {
        assert.notEqual(portOf(a), 7000);
        assert.notEqual(portOf(b), 7000);
        assert.notEqual(portOf(a), portOf(b));
        // the public property reflects the actual bound port
        assert.equal(a.port, portOf(a));
    } finally {
        await a.stop();
        await b.stop();
    }
});

test('responds to discovery scan with encrypted dev packet', async () => {
    const sim = await startEphemeralSim({ cid: 'aabbccddeeff' });
    const client = dgram.createSocket('udp4');
    try {
        client.bind(0);
        await new Promise(r => client.once('listening', r));

        const responsePromise = waitForMessage(client);
        await sendJson(client, { t: 'scan' }, portOf(sim));
        const envelope = await responsePromise;

        assert.equal(envelope.t, 'pack');
        assert.equal(envelope.cid, 'aabbccddeeff');
        const cipher = new EcbCipher();
        const inner = cipher.decrypt(envelope.pack);
        assert.equal(inner.t, 'dev');
        assert.equal(inner.cid, 'aabbccddeeff');
    } finally {
        client.close();
        await sim.stop();
    }
});

test('bind returns device key', async () => {
    const sim = await startEphemeralSim({ deviceKey: '0123456789abcdef' });
    const client = dgram.createSocket('udp4');
    try {
        client.bind(0);
        await new Promise(r => client.once('listening', r));

        const generic = new EcbCipher();
        const encrypted = generic.encrypt({
            mac: sim.cid,
            t: 'bind',
            uid: 0,
        });
        const responsePromise = waitForMessage(client);
        await sendJson(
            client,
            {
                cid: 'app',
                i: 1,
                t: 'pack',
                uid: 0,
                pack: encrypted.pack,
            },
            portOf(sim)
        );
        const envelope = await responsePromise;
        const inner = generic.decrypt(envelope.pack);
        assert.equal(inner.t, 'bindok');
        assert.equal(inner.key, '0123456789abcdef');
    } finally {
        client.close();
        await sim.stop();
    }
});

test('cmd updates state and emits change', async () => {
    const sim = await startEphemeralSim({ deviceKey: 'kkkkkkkkkkkkkkkk' });
    const client = dgram.createSocket('udp4');
    try {
        client.bind(0);
        await new Promise(r => client.once('listening', r));

        const deviceCipher = new EcbCipher('kkkkkkkkkkkkkkkk');
        let changeFired = null;
        sim.on('state-change', payload => (changeFired = payload));

        const cmd = deviceCipher.encrypt({
            t: 'cmd',
            opt: ['Pow', 'SetTem', 'Mod'],
            p: [1, 22, 1],
        });
        const responsePromise = waitForMessage(client);
        await sendJson(
            client,
            { cid: 'app', i: 0, t: 'pack', uid: 0, pack: cmd.pack },
            portOf(sim)
        );
        const envelope = await responsePromise;
        const inner = deviceCipher.decrypt(envelope.pack);

        assert.equal(inner.t, 'res');
        assert.deepEqual(inner.opt, ['Pow', 'SetTem', 'Mod']);
        assert.deepEqual(inner.val, [1, 22, 1]);
        assert.equal(sim.state.all.Pow, 1);
        assert.equal(sim.state.all.SetTem, 22);
        assert.equal(sim.state.all.Mod, 1);
        assert.ok(changeFired);
        assert.equal(changeFired.changed.Pow, 1);
    } finally {
        client.close();
        await sim.stop();
    }
});

test('status returns requested cols', async () => {
    const sim = await startEphemeralSim({
        deviceKey: 'mmmmmmmmmmmmmmmm',
        initialState: { Pow: 1, SetTem: 19 },
    });
    const client = dgram.createSocket('udp4');
    try {
        client.bind(0);
        await new Promise(r => client.once('listening', r));

        const deviceCipher = new EcbCipher('mmmmmmmmmmmmmmmm');
        const req = deviceCipher.encrypt({
            t: 'status',
            mac: sim.cid,
            cols: ['Pow', 'SetTem', 'Mod'],
        });
        const responsePromise = waitForMessage(client);
        await sendJson(
            client,
            { cid: 'app', i: 0, t: 'pack', uid: 0, pack: req.pack },
            portOf(sim)
        );
        const envelope = await responsePromise;
        const inner = deviceCipher.decrypt(envelope.pack);
        assert.equal(inner.t, 'dat');
        assert.deepEqual(inner.cols, ['Pow', 'SetTem', 'Mod']);
        assert.deepEqual(inner.dat, [1, 19, 0]);
    } finally {
        client.close();
        await sim.stop();
    }
});

test('fault injection: dropEvery drops Nth response', async () => {
    const sim = await startEphemeralSim({
        deviceKey: 'kkkkkkkkkkkkkkkk',
        faults: { dropEvery: 2 },
    });
    const client = dgram.createSocket('udp4');
    try {
        client.bind(0);
        await new Promise(r => client.once('listening', r));

        const generic = new EcbCipher();
        const received = [];
        client.on('message', buf => received.push(buf));

        for (let i = 0; i < 4; i++) {
            const enc = generic.encrypt({ mac: sim.cid, t: 'bind', uid: 0 });
            await sendJson(
                client,
                {
                    cid: 'app',
                    i: 1,
                    t: 'pack',
                    uid: 0,
                    pack: enc.pack,
                },
                portOf(sim)
            );
        }
        // Give time for all sends + drops
        await new Promise(r => setTimeout(r, 200));
        assert.equal(received.length, 2);
        assert.equal(sim.stats.packetsDropped, 2);
    } finally {
        client.close();
        await sim.stop();
    }
});

test('setCurrentTemperature applies the +40 offset by default', () => {
    const state = new DeviceState();
    state.setCurrentTemperature(25);
    assert.equal(state.all.TemSen, 65);
});

test('temSenOffset:0 models a firmware that reports real °C on the wire (#10)', () => {
    const state = new DeviceState({}, { temSenOffset: 0 });
    state.setCurrentTemperature(31);
    assert.equal(state.all.TemSen, 31);
});
