'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureStack, teardownStack } = require('./global-setup');
const { get, postJson, waitFor } = require('./harness');

const NR = 'http://127.0.0.1:1880';
const SIM = 'http://127.0.0.1:8080';
const INJECT_ON = 'a1c0de0000000002';
const INJECT_OFF = 'a1c0de0000000004';

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
    // docker/nodered/build-flows.js wraps examples/basic-control.json in one tab
    const tab = flows.find(n => n.id === 'gree-dev-tab');
    assert.ok(tab, 'expected the dev tab to be present');
    const gree = flows.find(n => n.type === 'gree-hvac');
    assert.equal(gree?.z, 'gree-dev-tab');
});

test('node-red gree-hvac config node points at gree.lan', async () => {
    const r = await get(`${NR}/flows`);
    const flows = JSON.parse(r.body);
    const cfg = flows.find(n => n.type === 'gree-hvac-config');
    assert.ok(cfg, 'expected a gree-hvac-config node');
    assert.equal(cfg.host, 'gree.lan');
});

test('sim state can be forced via its HTTP API', async () => {
    // Force the AC into a known state via the sim's /api/set, then read it back.
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
    // The example flow's inject nodes (ids from examples/basic-control.json)
    // are wired straight into the Gree node. Firing them over the admin API
    // exercises the real path: Node-RED flow -> gree-hvac node -> UDP ->
    // simulator.

    // Start from a known-off state.
    await postJson(`${SIM}/api/set`, { Pow: 0 });

    // 1. "On, cool to 24 °C" -> {power:'on', mode:'cool', temperature:24}
    await triggerInject(INJECT_ON);
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

    // 2. "Off" -> topic power, payload off
    await triggerInject(INJECT_OFF);
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
 *
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
