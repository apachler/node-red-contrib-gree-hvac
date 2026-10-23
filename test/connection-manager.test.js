'use strict';

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const { ConnectionManager } = require('../gree-hvac/lib/connection-manager');

/**
 * Minimal stand-in for gree-hvac-client's Client (>= 4.4): it owns
 * reconnecting, so tests drive its events directly.
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
        this.connectResult = Promise.resolve();
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
        return this.connectResult;
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
    // the device bound (first connect or a re-bind)
    simulateConnect() {
        this.emit('connect', this);
    }
    simulateUpdate(updated, properties) {
        this.emit('update', updated, properties || updated);
    }
    simulateNoResponse() {
        this.emit('no_response', this);
    }
    simulateReconnecting(info) {
        this.emit('reconnecting', info);
    }
    simulateError(err) {
        this.emit('error', err);
    }
}
FakeClient.reset();

// Same shape as gree-hvac-client's error: the manager recognises it by name.
class ClientInvalidPropertyError extends Error {
    constructor(message, props) {
        super(message);
        this.props = props;
    }
}

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

/**
 * A started manager whose client has bound.
 *
 * @param overrides
 * @returns {Promise<{mgr: ConnectionManager, client: FakeClient}>}
 */
async function connectedManager(overrides) {
    FakeClient.reset();
    const mgr = makeManager(overrides);
    mgr.start();
    const client = FakeClient.last;
    client.simulateConnect();
    await tick(0);
    return { mgr, client };
}

test('start builds one client that owns recovery, with the node settings mapped', async () => {
    FakeClient.reset();
    const mgr = makeManager({
        clientOptions: { subUnit: 'c0ffee000001', halfDegree: true },
    });
    mgr.start();
    mgr.start(); // idempotent
    assert.equal(FakeClient.instances.length, 1);
    const client = FakeClient.last;
    assert.equal(client.connectCalls, 1);
    assert.deepEqual(
        {
            host: client.opts.host,
            maxNoResponse: client.opts.maxNoResponse,
            recoveryDelay: client.opts.recoveryDelay,
            reconnectMaxDelay: client.opts.reconnectMaxDelay,
            connectTimeout: client.opts.connectTimeout,
            reopenSocket: client.opts.reopenSocket,
            autoConnect: client.opts.autoConnect,
            subUnit: client.opts.subUnit,
            halfDegree: client.opts.halfDegree,
        },
        {
            host: '10.0.0.1',
            maxNoResponse: 3,
            recoveryDelay: 50,
            reconnectMaxDelay: 1000,
            connectTimeout: 200,
            reopenSocket: true,
            autoConnect: false,
            subUnit: 'c0ffee000001',
            halfDegree: true,
        }
    );
    await mgr.stop();
});

test('connect sets connected with the device id and marks it as a bind', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    const states = [];
    mgr.on('state', (s, prev, meta) => states.push([s, meta]));
    mgr.start();
    FakeClient.last.simulateConnect();
    assert.equal(mgr.isConnected(), true);
    assert.equal(mgr.deviceId, 'fake-cid');
    assert.deepEqual(
        states.map(([s]) => s),
        ['connecting', 'connected']
    );
    assert.equal(states[1][1].bound, true);
    await mgr.stop();
});

test('a rejected first connect() is logged, not thrown', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    const logs = [];
    mgr.on('log', (level, message) => logs.push(message));
    const proto = FakeClient.prototype.connect;
    FakeClient.prototype.connect = function () {
        this.connectCalls += 1;
        return Promise.reject(new Error('send failed'));
    };
    try {
        mgr.start();
        await tick(5);
    } finally {
        FakeClient.prototype.connect = proto;
    }
    assert.ok(logs.includes('Connect attempt ended'));
    assert.equal(mgr.state, 'connecting');
    await mgr.stop();
});

test('queue coalesces multiple writes to the same property', async () => {
    const { mgr, client } = await connectedManager({ commandRateMs: 0 });
    mgr.send({ temperature: 22 });
    mgr.send({ temperature: 23 });
    mgr.send({ temperature: 24, power: 'on' });
    await tick(30);
    assert.deepEqual(client.setPropertiesCalls, [
        { temperature: 24, power: 'on' },
    ]);
    await mgr.stop();
});

test('queue is throttled by commandRateMs', async () => {
    const { mgr, client } = await connectedManager({ commandRateMs: 80 });
    mgr.send({ power: 'on' });
    await tick(10);
    assert.equal(client.setPropertiesCalls.length, 1);
    // second write within the throttle window should be deferred
    mgr.send({ power: 'off' });
    await tick(10);
    assert.equal(client.setPropertiesCalls.length, 1);
    await tick(120);
    assert.equal(client.setPropertiesCalls.length, 2);
    await mgr.stop();
});

test('queue overflow evicts oldest entries and emits diagnostic', async () => {
    FakeClient.reset();
    const mgr = makeManager({ maxQueueSize: 2 });
    const diags = [];
    mgr.on('diagnostic', d => diags.push(d));
    mgr.start(); // not connected: writes stay queued
    mgr.send({ a: 1 });
    mgr.send({ b: 1 });
    mgr.send({ c: 1 });
    mgr.send({ d: 1 });
    assert.deepEqual([...mgr.queue.keys()], ['c', 'd']);
    assert.ok(diags.some(d => d.event === 'queue_overflow'));
    assert.equal(mgr.metrics().queueOverflows, 2);
    await mgr.stop();
});

test('rejectIfOffline returns accepted=false while disconnected', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    mgr.start();
    const res = mgr.send({ power: 'on' }, { rejectIfOffline: true });
    assert.deepEqual(res, { accepted: false, reason: 'offline' });
    await mgr.stop();
});

test('writes made while offline are held and sent once the client binds', async () => {
    FakeClient.reset();
    const mgr = makeManager({ commandRateMs: 0 });
    mgr.start();
    const client = FakeClient.last;
    mgr.send({ power: 'on' });
    await tick(20);
    assert.equal(client.setPropertiesCalls.length, 0);
    client.simulateConnect();
    await tick(20);
    assert.deepEqual(client.setPropertiesCalls, [{ power: 'on' }]);
    await mgr.stop();
});

test('no_response is reported with its streak; an answer clears it', async () => {
    const { mgr, client } = await connectedManager();
    const states = [];
    mgr.on('state', (s, prev, meta) => states.push([s, meta]));
    client.simulateNoResponse();
    client.simulateNoResponse();
    assert.equal(mgr.state, 'no_response');
    assert.equal(mgr.metrics().noResponseStreak, 2);
    client.simulateUpdate({ power: 'on' });
    assert.equal(mgr.state, 'connected');
    assert.equal(mgr.metrics().noResponseStreak, 0);
    // answers resuming is no new bind
    assert.equal(states.at(-1)[1].bound, undefined);
    // no teardown: the client owns the re-bind
    assert.equal(client.disconnectCalls, 0);
    assert.equal(FakeClient.instances.length, 1);
    await mgr.stop();
});

test('reconnecting from the client: state per attempt, writes held, drained after the re-bind', async () => {
    const { mgr, client } = await connectedManager({ commandRateMs: 0 });
    const states = [];
    mgr.on('state', (s, prev, meta) => states.push([s, meta]));

    client.simulateReconnecting({
        attempt: 1,
        delayMs: 50,
        reason: 'no_response',
    });
    client.simulateReconnecting({
        attempt: 2,
        delayMs: 0,
        reason: 'connect_timeout',
    });
    assert.equal(mgr.isConnected(), false);
    assert.deepEqual(
        states.map(([s, meta]) => [s, meta.attempt, meta.reason]),
        [
            ['reconnecting', 1, 'no_response'],
            ['reconnecting', 2, 'connect_timeout'],
        ]
    );
    assert.equal(mgr.metrics().reconnectAttempt, 2);
    assert.equal(mgr.metrics().lastReconnect.reason, 'connect_timeout');

    mgr.send({ power: 'off' });
    await tick(20);
    assert.equal(client.setPropertiesCalls.length, 0);

    client.simulateConnect();
    await tick(20);
    assert.deepEqual(client.setPropertiesCalls, [{ power: 'off' }]);
    assert.equal(mgr.metrics().reconnectAttempt, 0);
    assert.equal(states.at(-1)[0], 'connected');
    assert.equal(states.at(-1)[1].bound, true);
    await mgr.stop();
});

test('client errors are reported but never tear the client down', async () => {
    const { mgr, client } = await connectedManager();
    const failures = [];
    const diags = [];
    mgr.on('failure', e => failures.push(e));
    mgr.on('diagnostic', d => diags.push(d));
    client.simulateError(new Error('boom'));
    assert.equal(failures.length, 1);
    assert.ok(
        diags.some(d => d.event === 'error' && d.message === 'boom'),
        'error diagnostic'
    );
    assert.equal(client.disconnectCalls, 0);
    assert.equal(mgr.isConnected(), true);
    await mgr.stop();
});

test('a write the client could not send is requeued and sent after the re-bind', async () => {
    const { mgr, client } = await connectedManager({ commandRateMs: 0 });
    const failed = [];
    mgr.on('write_failed', (err, batch) => failed.push(batch));
    client.setPropertiesReject = new Error('not connected');
    mgr.send({ power: 'on' });
    await tick(20);
    assert.deepEqual(failed, [{ power: 'on' }]);
    // requeued; sent again right away since still connected
    await tick(20);
    assert.deepEqual(client.setPropertiesCalls, [
        { power: 'on' },
        { power: 'on' },
    ]);
    await mgr.stop();
});

test('a property the client refuses is dropped, the rest of the batch sent', async () => {
    const { mgr, client } = await connectedManager({ commandRateMs: 0 });
    const failed = [];
    mgr.on('write_failed', (err, batch) => failed.push(batch));
    const original = client.setProperties.bind(client);
    client.setProperties = batch => {
        if ('temperature' in batch) {
            throw new ClientInvalidPropertyError('Invalid value 99', {
                property: 'temperature',
                value: 99,
            });
        }
        return original(batch);
    };

    mgr.send({ power: 'on', temperature: 99 });
    await tick(30);
    assert.deepEqual(client.setPropertiesCalls, [{ power: 'on' }]);
    assert.deepEqual(failed, [{ temperature: 99 }]);
    assert.equal(mgr.isConnected(), true);
    await mgr.stop();
});

test('an asynchronous invalid-property rejection is not requeued', async () => {
    const { mgr, client } = await connectedManager({ commandRateMs: 0 });
    const failed = [];
    mgr.on('write_failed', err => failed.push(err));
    client.setPropertiesReject = new ClientInvalidPropertyError('nope', {
        property: 'mode',
    });
    mgr.send({ mode: 'sideways' });
    await tick(30);
    assert.equal(failed.length, 1);
    assert.equal(mgr.queue.size, 0);
    assert.equal(client.setPropertiesCalls.length, 1);
    await mgr.stop();
});

test('call() delegates to the bound client and rejects while offline', async () => {
    FakeClient.reset();
    const mgr = makeManager();
    mgr.start();
    await assert.rejects(mgr.call('getDeviceInfo'), /offline/);

    const client = FakeClient.last;
    client.getVendorProperties = codes =>
        Promise.resolve(Object.fromEntries(codes.map(c => [c, 1])));
    client.simulateConnect();
    assert.deepEqual(await mgr.call('getVendorProperties', ['Pow']), {
        Pow: 1,
    });
    await assert.rejects(mgr.call('noSuchMethod'), /unsupported/);
    client.setName = () => {
        throw new Error('sync boom');
    };
    await assert.rejects(mgr.call('setName', 'x'), /sync boom/);
    client.simulateReconnecting({ attempt: 1, delayMs: 0, reason: 'x' });
    await assert.rejects(mgr.call('getVendorProperties', ['Pow']), /offline/);
    await mgr.stop();
    await assert.rejects(mgr.call('getVendorProperties', ['Pow']), /offline/);
});

test('stop disconnects the client once and refuses further writes', async () => {
    const { mgr, client } = await connectedManager();
    mgr.send({ power: 'on' });
    await mgr.stop();
    await mgr.stop();
    assert.equal(client.disconnectCalls, 1);
    assert.equal(mgr.state, 'stopped');
    assert.equal(mgr.queue.size, 0);
    assert.deepEqual(mgr.send({ power: 'off' }), {
        accepted: false,
        reason: 'stopped',
    });
    mgr.start(); // no restart after stop
    assert.equal(FakeClient.instances.length, 1);
});

test('metrics snapshot includes uptime, contact and queue size', async () => {
    const { mgr, client } = await connectedManager({ commandRateMs: 5000 });
    client.simulateUpdate({ power: 'on' });
    mgr.send({ a: 1 }); // goes out at once
    await tick(10);
    mgr.send({ b: 1 }); // waits for commandRateMs
    const m = mgr.metrics();
    assert.equal(m.state, 'connected');
    assert.equal(m.connected, true);
    assert.equal(m.deviceId, 'fake-cid');
    assert.ok(m.uptimeMs >= 0);
    assert.ok(m.lastContactAt > 0);
    assert.equal(m.queueSize, 1);
    await mgr.stop();
});
