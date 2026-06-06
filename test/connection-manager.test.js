'use strict';

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const { ConnectionManager } = require('../gree-hvac/lib/connection-manager');

/**
 * Minimal stand-in for the upstream gree-hvac-client Client class.
 * Tests drive it directly via the spawned() helper.
 */
class FakeClient extends EventEmitter {
    constructor(opts) {
        super();
        this.opts = opts;
        this.deviceId = 'fake-cid';
        this.connectCalls = 0;
        this.disconnectCalls = 0;
        this.setPropertiesCalls = [];
        this.setPropertiesReject = null;
        this._socket = null;
        FakeClient.last = this;
        FakeClient.instances.push(this);
    }
    static reset() {
        FakeClient.last = null;
        FakeClient.instances = [];
    }
    getDeviceId() {
        return this.deviceId;
    }
    connect() {
        this.connectCalls += 1;
        return Promise.resolve();
    }
    disconnect() {
        this.disconnectCalls += 1;
        return Promise.resolve();
    }
    setProperties(batch) {
        this.setPropertiesCalls.push(batch);
        if (this.setPropertiesReject) {
            const e = this.setPropertiesReject;
            this.setPropertiesReject = null;
            return Promise.reject(e);
        }
        return Promise.resolve();
    }
    // simulate the device coming online: emits 'connect' after a tick
    simulateConnect() {
        process.nextTick(() => this.emit('connect'));
    }
    simulateUpdate(updated, properties) {
        this.emit('update', updated, properties || updated);
    }
    simulateNoResponse() {
        this.emit('no_response');
    }
    simulateError(err) {
        this.emit('error', err);
    }
}
FakeClient.reset();

/**
 * @param overrides
 * @returns {ConnectionManager}
 */
function makeManager(overrides) {
    return new ConnectionManager({
        ClientCtor: FakeClient,
        host: '10.0.0.1',
        port: 7000,
        pollingIntervalMs: 100,
        pollingTimeoutMs: 200,
        connectTimeoutMs: 200,
        recoveryDelayMs: 50,
        maxBackoffMs: 1000,
        unresponsiveTimeoutMs: 500,
        connectingTimeoutMs: 1000,
        watchdogTickMs: 25,
        commandRateMs: 20,
        noResponseThreshold: 3,
        maxQueueSize: 4,
        logLevel: 'error',
        ...overrides,
    });
}

/**
 * @param ms
 * @returns {Promise<void>}
 */
function tick(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

test('connects and exposes deviceId on connect', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    const states = [];
    mgr.on('state', s => states.push(s));
    mgr.start();
    await tick(0);
    FakeClient.last.simulateConnect();
    await tick(5);
    assert.equal(mgr.isConnected(), true);
    assert.equal(mgr.deviceId, 'fake-cid');
    assert.deepEqual(states.slice(0, 2), ['connecting', 'connected']);
    await mgr.stop();
});

test('queue coalesces multiple writes to the same property', async () => {
    FakeClient.reset();
    const mgr = makeManager({ commandRateMs: 0 });
    mgr.start();
    await tick(0);
    FakeClient.last.simulateConnect();
    await tick(5);

    mgr.send({ temperature: 22 });
    mgr.send({ temperature: 23 });
    mgr.send({ temperature: 24, power: 'on' });
    await tick(30);
    assert.equal(FakeClient.last.setPropertiesCalls.length, 1);
    assert.deepEqual(FakeClient.last.setPropertiesCalls[0], {
        temperature: 24,
        power: 'on',
    });
    await mgr.stop();
});

test('queue is throttled by commandRateMs', async () => {
    FakeClient.reset();
    const mgr = makeManager({ commandRateMs: 80 });
    mgr.start();
    await tick(0);
    FakeClient.last.simulateConnect();
    await tick(5);

    mgr.send({ power: 'on' });
    await tick(10);
    assert.equal(FakeClient.last.setPropertiesCalls.length, 1);
    // second write within the throttle window should be deferred
    mgr.send({ power: 'off' });
    await tick(10);
    assert.equal(FakeClient.last.setPropertiesCalls.length, 1);
    await tick(120);
    assert.equal(FakeClient.last.setPropertiesCalls.length, 2);
    await mgr.stop();
});

test('queue overflow evicts oldest entries and emits diagnostic', async () => {
    FakeClient.reset();
    const mgr = makeManager({ maxQueueSize: 2, commandRateMs: 5000 });
    const diags = [];
    mgr.on('diagnostic', d => diags.push(d));
    mgr.start();
    await tick(0);
    FakeClient.last.simulateConnect();
    await tick(5);
    // drain the initial dummy send window
    await tick(5);
    // now stack up more than cap; values are distinct keys so they don't coalesce
    mgr.send({ a: 1 });
    mgr.send({ b: 1 });
    mgr.send({ c: 1 });
    mgr.send({ d: 1 });
    // the first three "a","b" should be evicted down to 2
    assert.equal(mgr.queue.size, 2);
    assert.ok(diags.some(d => d.event === 'queue_overflow'));
    await mgr.stop();
});

test('rejectIfOffline returns accepted=false while disconnected', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    mgr.start();
    await tick(0);
    const res = mgr.send({ power: 'on' }, { rejectIfOffline: true });
    assert.equal(res.accepted, false);
    assert.equal(res.reason, 'offline');
    await mgr.stop();
});

test('no_response streak forces a reset after threshold', async () => {
    FakeClient.reset();
    const mgr = makeManager({ noResponseThreshold: 2, recoveryDelayMs: 30 });
    mgr.start();
    await tick(0);
    const c1 = FakeClient.last;
    c1.simulateConnect();
    await tick(5);
    c1.simulateNoResponse();
    c1.simulateNoResponse();
    // reset path runs through teardownClient async; wait for new client
    await tick(80);
    assert.notEqual(FakeClient.last, c1);
    assert.equal(c1.disconnectCalls, 1);
    await mgr.stop();
});

test('exponential backoff grows on repeated failures', async () => {
    FakeClient.reset();
    const mgr = makeManager({ recoveryDelayMs: 10, maxBackoffMs: 1000 });
    mgr.start();
    await tick(0);
    const c1 = FakeClient.last;
    c1.simulateError(new Error('boom'));
    // wait long enough for the reconnect timer to have fired and a fresh
    // client to exist (avoids a race against the same-delay tick())
    await tick(60);
    const after1 = mgr.backoffMs;
    assert.notEqual(
        FakeClient.last,
        c1,
        'reconnect should have built a new client'
    );
    FakeClient.last.simulateError(new Error('boom'));
    await tick(80);
    const after2 = mgr.backoffMs;
    assert.ok(
        after2 > after1,
        'backoff should grow on repeated failures (after1=' +
            after1 +
            ' after2=' +
            after2 +
            ')'
    );
    await mgr.stop();
});

test('backoff resets to recoveryDelayMs after a successful connect', async () => {
    FakeClient.reset();
    const mgr = makeManager({ recoveryDelayMs: 10 });
    mgr.start();
    await tick(0);
    FakeClient.last.simulateError(new Error('boom'));
    await tick(20);
    assert.ok(mgr.backoffMs > 10);
    // next attempt succeeds
    await tick(80);
    FakeClient.last.simulateConnect();
    await tick(5);
    assert.equal(mgr.backoffMs, 10);
    await mgr.stop();
});

test('stop tears down client and ignores late events', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    mgr.start();
    await tick(0);
    const c = FakeClient.last;
    c.simulateConnect();
    await tick(5);
    let lateUpdates = 0;
    mgr.on('update', () => (lateUpdates += 1));
    await mgr.stop();
    // events from the now-detached client should be ignored
    c.simulateUpdate({ temperature: 21 });
    c.simulateError(new Error('after stop'));
    await tick(20);
    assert.equal(lateUpdates, 0);
    assert.equal(c.disconnectCalls, 1);
});

test('metrics snapshot includes uptime and queue size', async () => {
    FakeClient.reset();
    const mgr = makeManager({ commandRateMs: 5000 });
    mgr.start();
    await tick(0);
    FakeClient.last.simulateConnect();
    await tick(15);
    mgr.send({ power: 'on' });
    mgr.send({ temperature: 22 });
    const m = mgr.metrics();
    assert.equal(m.state, 'connected');
    assert.equal(m.deviceId, 'fake-cid');
    assert.ok(m.uptimeMs >= 0);
    assert.equal(m.queueSize, 2);
    await mgr.stop();
});

test('write_failed is emitted with the original batch', async () => {
    FakeClient.reset();
    const mgr = makeManager({ commandRateMs: 0, recoveryDelayMs: 9999 });
    let failed = null;
    mgr.on('write_failed', (err, batch) => {
        failed = { err, batch };
    });
    mgr.start();
    await tick(0);
    FakeClient.last.simulateConnect();
    await tick(5);
    FakeClient.last.setPropertiesReject = new Error('send fail');
    mgr.send({ power: 'on' });
    await tick(30);
    assert.ok(failed);
    assert.equal(failed.err.message, 'send fail');
    assert.deepEqual(failed.batch, { power: 'on' });
    await mgr.stop();
});

test('stuck-connecting watchdog forces reset', async () => {
    FakeClient.reset();
    const mgr = makeManager({
        connectingTimeoutMs: 100,
        watchdogTickMs: 20,
        recoveryDelayMs: 20,
    });
    mgr.start();
    await tick(0);
    const c1 = FakeClient.last;
    // never call simulateConnect — manager should give up after connectingTimeoutMs.
    // budget: ~connectingTimeoutMs + a watchdog tick + recoveryDelayMs + slack
    await tick(300);
    assert.notEqual(FakeClient.last, c1);
    await mgr.stop();
});

test('setHost re-points to a new address by rebuilding the client', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    mgr.start();
    await tick(0);
    const c1 = FakeClient.last;
    c1.simulateConnect();
    await tick(5);
    assert.equal(c1.opts.host, '10.0.0.1');

    const changed = mgr.setHost('10.0.0.2');
    assert.equal(changed, true);
    // teardown -> rebuild happens async
    await tick(10);
    assert.notEqual(FakeClient.last, c1);
    assert.equal(FakeClient.last.opts.host, '10.0.0.2');
    assert.equal(c1.disconnectCalls, 1);
    await mgr.stop();
});

test('setHost is a no-op when the address is unchanged', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    mgr.start();
    await tick(0);
    const c1 = FakeClient.last;
    c1.simulateConnect();
    await tick(5);

    assert.equal(mgr.setHost('10.0.0.1'), false);
    assert.equal(mgr.setHost(''), false);
    await tick(10);
    assert.equal(FakeClient.last, c1); // no rebuild
    await mgr.stop();
});

test('setHost resets the backoff so the move connects promptly', async () => {
    FakeClient.reset();
    const mgr = makeManager({ recoveryDelayMs: 10 });
    mgr.start();
    await tick(0);
    FakeClient.last.simulateError(new Error('boom'));
    await tick(20);
    assert.ok(mgr.backoffMs > 10, 'backoff grew after a failure');

    mgr.setHost('10.0.0.2');
    assert.equal(mgr.backoffMs, 10, 'setHost reset backoff to recoveryDelayMs');
    await tick(10);
    assert.equal(mgr.opts.host, '10.0.0.2');
    await mgr.stop();
});

test('setHost while stopped updates host without rebuilding', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    mgr.start();
    await tick(0);
    await mgr.stop();
    const lastBefore = FakeClient.last;

    assert.equal(mgr.setHost('10.0.0.9'), true);
    assert.equal(mgr.opts.host, '10.0.0.9');
    await tick(10);
    assert.equal(FakeClient.last, lastBefore); // stopped: no new client
});
