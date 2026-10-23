'use strict';

// In-process tests for the simulator's HTTP API + SSE stream (the same
// endpoints the dockerized e2e suite drives, but counted by coverage).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { Simulator } = require('../src/simulator');
const { Dashboard } = require('../src/dashboard');

const startStack = async t => {
    const sim = new Simulator({ port: 0, bindAddress: '127.0.0.1' });
    await sim.start();
    const dash = new Dashboard(sim, {
        port: 0,
        bindAddress: '127.0.0.1',
    });
    await dash.start();
    t.after(async () => {
        await dash.stop();
        await sim.stop();
    });
    return { sim, dash, base: `http://127.0.0.1:${dash.port}` };
};

const request = (url, { method = 'GET', body } = {}) =>
    new Promise((resolve, reject) => {
        const req = http.request(url, { method }, res => {
            let data = '';
            res.on('data', c => (data += c));
            res.on('end', () =>
                resolve({
                    status: res.statusCode,
                    type: res.headers['content-type'],
                    text: data,
                    json: () => JSON.parse(data),
                })
            );
        });
        req.on('error', reject);
        if (body !== undefined) req.write(body);
        req.end();
    });

const post = (url, obj) =>
    request(url, {
        method: 'POST',
        body: typeof obj === 'string' ? obj : JSON.stringify(obj),
    });

test('serves the static dashboard assets', async t => {
    const { base } = await startStack(t);
    const cases = [
        ['/', /text\/html/],
        ['/app.js', /application\/javascript/],
        ['/styles.css', /text\/css/],
        ['/logo.svg', /image\/svg\+xml/],
        ['/favicon.ico', /image\/svg\+xml/],
    ];
    for (const [path, type] of cases) {
        const res = await request(base + path);
        assert.equal(res.status, 200, path);
        assert.match(res.type, type, path);
    }
    assert.equal((await request(base + '/nope')).status, 404);
});

test('GET /api/state returns identity, vendor + friendly state', async t => {
    const { sim, base } = await startStack(t);
    const state = (await request(base + '/api/state')).json();
    assert.equal(state.cid, sim.cid);
    assert.equal(state.cipher, 'ecb');
    assert.equal(state.vendor.Pow, 0);
    assert.equal(state.friendly.power, 'off');
});

test('POST /api/set applies properties with source "http"', async t => {
    const { base } = await startStack(t);
    const res = await post(base + '/api/set', { Pow: 1, SetTem: 19 });
    assert.equal(res.status, 200);
    const state = res.json();
    assert.equal(state.vendor.Pow, 1);
    assert.equal(state.vendor.SetTem, 19);
    assert.equal(state.lastChange.source, 'http');

    assert.equal((await post(base + '/api/set', '42')).status, 400);
    assert.equal((await post(base + '/api/set', '{bad')).status, 400);
});

test('POST /api/temperature sets the room reading (TemSen +40 offset)', async t => {
    const { base } = await startStack(t);
    const res = await post(base + '/api/temperature', { celsius: 27 });
    assert.equal(res.status, 200);
    assert.equal(res.json().currentTemperatureC, 27);
    assert.equal(
        (await post(base + '/api/temperature', { celsius: 'hot' })).status,
        400
    );
});

test('faults can be read and updated; bad JSON is a 400', async t => {
    const { base } = await startStack(t);
    const before = (await request(base + '/api/faults')).json();
    assert.equal(before.dropEvery, 0);
    const res = await post(base + '/api/faults', {
        dropEvery: 3,
        latencyMs: 5,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json().dropEvery, 3);
    assert.equal((await post(base + '/api/faults', 'nope')).status, 400);
});

test('stats can be read and reset', async t => {
    const { base } = await startStack(t);
    const stats = (await request(base + '/api/stats')).json();
    assert.equal(typeof stats.packetsRx, 'number');
    const reset = await post(base + '/api/stats/reset', {});
    assert.equal(reset.status, 200);
    assert.equal(reset.json().packetsRx, 0);
});

test('rejects request bodies over 64 KiB', async t => {
    const { base } = await startStack(t);
    const big = JSON.stringify({ pad: 'x'.repeat(70 * 1024) });
    const res = await post(base + '/api/faults', big).catch(e => e);
    // Either a 400 or a reset connection, depending on timing.
    assert.ok(res instanceof Error || res.status === 400);
});

test('SSE stream sends a snapshot on connect and broadcasts changes', async t => {
    const { sim, base } = await startStack(t);
    const events = [];
    const res = await new Promise((resolve, reject) => {
        http.get(base + '/api/events', resolve).on('error', reject);
    });
    t.after(() => res.destroy());
    assert.match(res.headers['content-type'], /text\/event-stream/);
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', chunk => {
        buf += chunk;
        for (const m of buf.matchAll(/event: (\w+)\n/g)) events.push(m[1]);
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });

    const waitEvent = async name => {
        for (let i = 0; i < 100 && !events.includes(name); i++) {
            await new Promise(r => setTimeout(r, 20));
        }
        assert.ok(events.includes(name), `expected SSE event "${name}"`);
    };

    await waitEvent('state');
    await waitEvent('stats');

    events.length = 0;
    sim.state.apply(['Pow'], [1], 'test');
    await waitEvent('state');
});
