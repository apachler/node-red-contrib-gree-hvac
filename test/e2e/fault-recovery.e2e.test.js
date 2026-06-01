'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureStack, teardownStack } = require('./global-setup');
const { get, postJson, waitFor } = require('./harness');
const Gree = require('gree-hvac-client');

test.before(async () => {
    await ensureStack({ skipBuild: process.env.E2E_SKIP_BUILD === '1' });
});

test.after(async () => {
    if (process.env.E2E_KEEP_UP === '1') return;
    // reset faults so other tests aren't affected
    try {
        await postJson('http://127.0.0.1:8080/api/faults', {
            dropProbability: 0,
            dropEvery: 0,
            latencyMs: 0,
            jitterMs: 0,
        });
    } catch (_) {
        /* sim may already be down */
    }
    await teardownStack();
});

test('client recovers status polling after every-other-packet drop', async t => {
    // Drop every 2nd packet — client should still recover via retries+poll.
    const apply = await postJson('http://127.0.0.1:8080/api/faults', {
        dropEvery: 2,
    });
    assert.equal(apply.status, 200);

    const client = new Gree.Client({
        host: '127.0.0.1',
        port: 7000,
        autoConnect: false,
        poll: true,
        pollingInterval: 1000,
        pollingTimeout: 2000,
        connectTimeout: 6000,
    });

    t.after(async () => {
        await postJson('http://127.0.0.1:8080/api/faults', {
            dropEvery: 0,
        });
        try {
            await client.disconnect();
        } catch (_) {
            /* already disconnected */
        }
    });

    // It may take a few attempts to even connect since every 2nd response is
    // dropped; allow up to 30s. Just observe at least one successful update.
    let gotUpdate = false;
    client.on('update', () => {
        gotUpdate = true;
    });
    client.on('error', () => {
        /* expected during recovery */
    });

    await client.connect().catch(() => {
        /* may transiently fail; rely on update event */
    });
    await waitFor(() => gotUpdate, {
        timeout: 30000,
        interval: 500,
        label: 'at least one status update under drop=every-2nd',
    });

    const r = await get('http://127.0.0.1:8080/api/stats');
    const stats = JSON.parse(r.body);
    assert.ok(stats.packetsDropped > 0);
});
