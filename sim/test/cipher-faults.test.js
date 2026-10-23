'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    EcbCipher,
    GcmCipher,
    randomDeviceKey,
    ECB_GENERIC_KEY,
    GCM_GENERIC_KEY,
} = require('../src/cipher');
const { FaultInjector } = require('../src/fault-injection');
const { Simulator } = require('../src/simulator');
const Gree = require('gree-hvac-client');

test('ECB and GCM ciphers round-trip with generic and device keys', () => {
    const msg = { t: 'status', cols: ['Pow'], dat: [1] };
    for (const Cipher of [EcbCipher, GcmCipher]) {
        const c = new Cipher();
        assert.equal(
            c.getKey(),
            Cipher === EcbCipher ? ECB_GENERIC_KEY : GCM_GENERIC_KEY
        );
        const key = randomDeviceKey();
        c.setKey(key);
        assert.equal(c.getKey(), key);
        const enc = c.encrypt(msg);
        // both return { pack } (GCM adds the auth tag)
        assert.deepEqual(c.decrypt(enc.pack, enc.tag), msg);
    }
});

test('GCM rejects a tampered auth tag', () => {
    const c = new GcmCipher();
    const { pack } = c.encrypt({ t: 'scan' });
    const badTag = Buffer.alloc(16).toString('base64');
    assert.throws(() => c.decrypt(pack, badTag));
});

test('randomDeviceKey returns 16 alphanumeric chars', () => {
    const k = randomDeviceKey();
    assert.match(k, /^[A-Za-z0-9]{16}$/);
    assert.notEqual(k, randomDeviceKey());
});

test('FaultInjector: dropEvery, probability, latency + jitter, clamping', () => {
    const every = new FaultInjector({ dropEvery: 2 });
    assert.deepEqual(
        [1, 2, 3, 4].map(() => every.shouldDrop()),
        [false, true, false, true]
    );

    const always = new FaultInjector({ dropProbability: 5 }); // clamped to 1
    assert.equal(always.snapshot().dropProbability, 1);
    assert.equal(always.shouldDrop(), true);

    const none = new FaultInjector();
    assert.equal(none.shouldDrop(), false);
    assert.equal(none.delay(), 0);

    const slow = new FaultInjector({ latencyMs: 10, jitterMs: 5 });
    for (let i = 0; i < 20; i++) {
        const d = slow.delay();
        assert.ok(d >= 10 && d < 15, `delay ${d} out of range`);
    }

    slow.update({
        latencyMs: -3,
        jitterMs: -1,
        dropEvery: 2.7,
        dropProbability: -1,
    });
    assert.deepEqual(slow.snapshot(), {
        dropProbability: 0,
        latencyMs: 0,
        jitterMs: 0,
        dropEvery: 2,
    });
});

test('real client binds over AES-GCM against a GCM-mode simulator', async t => {
    const sim = new Simulator({
        port: 0,
        bindAddress: '127.0.0.1',
        cipherMode: 'gcm',
        cid: '0a0b0c0d0e0f',
    });
    await sim.start();
    const client = new Gree.Client({
        host: '127.0.0.1',
        port: sim._socket.address().port,
        autoConnect: false,
        poll: false,
        connectTimeout: 4000,
    });
    t.after(async () => {
        await client.disconnect().catch(() => {});
        await sim.stop();
    });

    const connected = new Promise(resolve => client.once('connect', resolve));
    await client.connect();
    await connected;
    assert.equal(client.getDeviceId(), '0a0b0c0d0e0f');

    const ack = new Promise(resolve => client.once('success', resolve));
    await client.setProperty(Gree.PROPERTY.power, Gree.VALUE.power.on);
    await ack;
    assert.equal(sim.state.all.Pow, 1);
});
