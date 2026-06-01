'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureStack, teardownStack } = require('./global-setup');
const { get, postJson, waitFor } = require('./harness');
const Gree = require('gree-hvac-client');

const SIM = 'http://127.0.0.1:8080';

test.before(async () => {
    await ensureStack({ skipBuild: process.env.E2E_SKIP_BUILD === '1' });
});

const resetFaults = () =>
    postJson(`${SIM}/api/faults`, {
        dropProbability: 0,
        dropEvery: 0,
        latencyMs: 0,
        jitterMs: 0,
    });

test.after(async () => {
    try {
        await resetFaults();
    } catch (_) {
        /* sim may already be down */
    }
    if (process.env.E2E_KEEP_UP === '1') return;
    await teardownStack();
});

test('client keeps polling status across injected packet drops', async t => {
    // Faults are injected AFTER a clean connect on purpose. gree-hvac-client
    // falls back to AES-GCM on its 2nd bind attempt, and this simulator is
    // ECB-only — so dropping the bindok during the handshake would wedge the
    // client in a cipher the sim can't answer. "Recovers status polling"
    // is about surviving loss on an established session, which is what we
    // exercise here.
    await resetFaults();

    const client = new Gree.Client({
        host: '127.0.0.1',
        port: 7000,
        autoConnect: false,
        poll: true,
        pollingInterval: 800,
        pollingTimeout: 2000,
        connectTimeout: 6000,
    });

    let updates = 0;
    client.on('update', () => {
        updates++;
    });
    client.on('error', () => {
        /* expected while packets are being dropped */
    });

    t.after(async () => {
        await resetFaults();
        try {
            await client.disconnect();
        } catch (_) {
            /* already disconnected */
        }
    });

    // 1. Clean connect + first status update.
    const connected = new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('clean connect timed out')),
            15000
        );
        client.once('connect', () => {
            clearTimeout(timer);
            resolve();
        });
    });
    await client.connect();
    await connected;
    await waitFor(() => updates > 0, {
        timeout: 10000,
        interval: 200,
        label: 'first status update before faults',
    });

    // 2. Now drop every 3rd outbound packet and confirm polling still gets
    //    through (the client retries on its polling interval).
    const baseline = updates;
    const apply = await postJson(`${SIM}/api/faults`, { dropEvery: 3 });
    assert.equal(apply.status, 200);

    await waitFor(() => updates > baseline, {
        timeout: 25000,
        interval: 250,
        label: 'a further status update while dropping every 3rd packet',
    });

    // 3. The sim should report it actually dropped packets.
    const stats = JSON.parse((await get(`${SIM}/api/stats`)).body);
    assert.ok(
        stats.packetsDropped > 0,
        `expected packetsDropped > 0, got ${stats.packetsDropped}`
    );
});
