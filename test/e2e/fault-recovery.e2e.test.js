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
            // restore the property the liveness probe flipped — the other
            // e2e files share this sim
            await postJson(`${SIM}/api/set`, { Lig: 0 });
        } catch (_) {
            /* sim may already be down */
        }
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
    //    through. `update` only fires when the polled state actually changed —
    //    counting updates on a *static* sim only "worked" on gree-hvac-client
    //    <= v3.0.4, where orphaned status timers (issue apachler/gree-hvac-client#7,
    //    fixed in v3.0.5) wiped the property cache and made every reply look
    //    like a change. So flip a property the flow logic doesn't touch over
    //    the sim's HTTP API and expect the change to surface through polling
    //    despite the drops.
    const apply = await postJson(`${SIM}/api/faults`, { dropEvery: 3 });
    assert.equal(apply.status, 200);

    let lightsSeen = null;
    client.on('update', changed => {
        if ('lights' in changed) {
            lightsSeen = changed.lights;
        }
    });
    const set = await postJson(`${SIM}/api/set`, { Lig: 1 });
    assert.equal(set.status, 200);

    await waitFor(() => lightsSeen === 'on', {
        timeout: 25000,
        interval: 250,
        label: 'the Lig change to surface via polling while dropping every 3rd packet',
    });

    // 3. Keep polling until the sim has actually dropped something — with
    //    dropEvery=3 the first drop is only on the 3rd response, which may be
    //    after the update above already surfaced.
    await waitFor(
        async () => {
            const stats = JSON.parse((await get(`${SIM}/api/stats`)).body);
            return stats.packetsDropped > 0;
        },
        {
            timeout: 25000,
            interval: 500,
            label: 'the sim to report packetsDropped > 0',
        }
    );

    // 4. And a change made after real drops still gets through.
    const unset = await postJson(`${SIM}/api/set`, { Lig: 0 });
    assert.equal(unset.status, 200);

    await waitFor(() => lightsSeen === 'off', {
        timeout: 25000,
        interval: 250,
        label: 'the Lig revert to surface via polling after packets were dropped',
    });
});
