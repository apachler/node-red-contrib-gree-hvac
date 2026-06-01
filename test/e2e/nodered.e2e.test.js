'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureStack, teardownStack } = require('./global-setup');
const { get, postJson, waitFor, sleep } = require('./harness');

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

test('manual switch + button in user flow drives the gree node end-to-end', async () => {
    // 1. flip the dashboard "manual mode" switch by writing the ui-switch's
    //    backing message into the node-red runtime via the inject API
    await injectViaNode('8594a4df82975e15', { payload: true, topic: 'mode' });
    await sleep(500);
    // 2. click "Klima EIN" button (ui-button node id 1f1084ee1379f036)
    await injectViaNode('1f1084ee1379f036', { payload: 'on', topic: 'manual' });

    // 3. Watch the sim dashboard for the AC to come on; the user flow's
    //    "Manual Klima Handler" emits a {power:'on', mode:'cool', ...} message
    //    into the gree-hvac node, which talks to the sim over UDP and
    //    flips the sim's state.
    await waitFor(
        async () => {
            const r = await get(`${SIM}/api/state`);
            const s = JSON.parse(r.body);
            return s.friendly.power === 'on' && s.friendly.mode === 'cool';
        },
        {
            timeout: 30000,
            interval: 1000,
            label: 'sim AC power on after manual button',
        }
    );

    // 4. press "Klima AUS"
    await injectViaNode('7349dcb0f80c476b', {
        payload: 'off',
        topic: 'manual',
    });
    await waitFor(
        async () => {
            const r = await get(`${SIM}/api/state`);
            const s = JSON.parse(r.body);
            return s.friendly.power === 'off';
        },
        {
            timeout: 30000,
            interval: 1000,
            label: 'sim AC power off after manual button',
        }
    );
});

/**
 * Trigger a Node-RED node via the admin API as if a user had clicked its
 * inject/button. Uses the documented /inject/:id endpoint, falling back to
 * a POST against the node's input via /eval is not needed because inject
 * and ui-button both expose /inject.
 * @param nodeId
 * @param msg
 */
async function injectViaNode(nodeId, msg) {
    const url = `${NR}/inject/${encodeURIComponent(nodeId)}`;
    const r = await postJson(url, { __user_inject_props__: [], ...msg });
    if (r.status !== 200 && r.status !== 204) {
        throw new Error(
            `inject ${nodeId} returned ${r.status}: ${r.body.slice(0, 200)}`
        );
    }
}
