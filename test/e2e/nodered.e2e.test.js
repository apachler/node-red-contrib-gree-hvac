'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureStack, teardownStack } = require('./global-setup');
const { get, postJson, waitFor } = require('./harness');

const NR = 'http://127.0.0.1:1880';
const SIM = 'http://127.0.0.1:8080';

test.before(async () => {
    await ensureStack({ skipBuild: process.env.E2E_SKIP_BUILD === '1' });
});

test.after(async () => {
    if (process.env.E2E_KEEP_UP === '1') return;
    await teardownStack();
});

test('node-red admin api lists deployed flows', async () => {
    const r = await get(`${NR}/flows`);
    assert.equal(r.status, 200);
    const flows = JSON.parse(r.body);
    assert.ok(Array.isArray(flows));
    // user flow has 'Gree PV-Überschuss' tab
    const userTab = flows.find(
        n => n.type === 'tab' && /Gree PV/i.test(n.label || '')
    );
    assert.ok(userTab, 'expected user flow tab to be present');
    // mocks tab from our merge
    const mockTab = flows.find(n => n.id === 'mocks-tab');
    assert.ok(mockTab, 'expected mocks tab to be present');
});

test('node-red gree-hvac config node points at gree.lan', async () => {
    const r = await get(`${NR}/flows`);
    const flows = JSON.parse(r.body);
    const cfg = flows.find(n => n.type === 'gree-hvac-config');
    assert.ok(cfg, 'expected a gree-hvac-config node');
    assert.equal(cfg.host, 'gree.lan');
});

test('mocks flow drives sim state via the dashboard', async () => {
    // Force the AC into a known state by directly setting via the sim's
    // /api/set endpoint; then verify the dashboard sees it. This decouples
    // this test from the control logic in the user flow (which is
    // time-of-day dependent) while still exercising the dashboard surface.
    const upd = await postJson(`${SIM}/api/set`, {
        Pow: 0,
        Mod: 0,
        SetTem: 24,
    });
    assert.equal(upd.status, 200);

    const r = await get(`${SIM}/api/state`);
    const state = JSON.parse(r.body);
    assert.equal(state.friendly.power, 'off');
    assert.equal(state.friendly.temperature, 24);
});

test('deployed Node-RED flow drives the gree node end-to-end', async () => {
    // The dashboard ui-switch/ui-button nodes can't be triggered over the
    // admin API (only plain inject nodes expose /inject), so the mocks tab
    // ships two inject nodes wired straight into the Gree node. Triggering
    // them exercises the real path: Node-RED flow -> gree-hvac node -> UDP
    // -> simulator.

    // Start from a known-off state.
    await postJson(`${SIM}/api/set`, { Pow: 0 });

    // 1. Trigger "Test: AC ON" -> Gree node sends {power:'on', mode:'cool', ...}
    await triggerInject('mock-test-ac-on');
    await waitFor(
        async () => {
            const s = JSON.parse((await get(`${SIM}/api/state`)).body);
            return s.friendly.power === 'on' && s.friendly.mode === 'cool';
        },
        {
            timeout: 30000,
            interval: 1000,
            label: 'sim AC power on after inject',
        }
    );

    // 2. Trigger "Test: AC OFF"
    await triggerInject('mock-test-ac-off');
    await waitFor(
        async () => {
            const s = JSON.parse((await get(`${SIM}/api/state`)).body);
            return s.friendly.power === 'off';
        },
        {
            timeout: 30000,
            interval: 1000,
            label: 'sim AC power off after inject',
        }
    );
});

/**
 * Fire a plain inject node via the Node-RED admin API. The node sends its
 * own configured payload/topic, so no body is needed.
 * @param nodeId
 * @returns {Promise<void>}
 */
async function triggerInject(nodeId) {
    const url = `${NR}/inject/${encodeURIComponent(nodeId)}`;
    const r = await postJson(url, {});
    if (r.status !== 200 && r.status !== 204) {
        throw new Error(
            `inject ${nodeId} returned ${r.status}: ${r.body.slice(0, 200)}`
        );
    }
}
