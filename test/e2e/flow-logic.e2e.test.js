'use strict';

// Full-stack e2e for the user flow's control logic. Unlike nodered.e2e.test.js
// (which triggers inject nodes wired straight to the Gree node, bypassing the
// brain), this drives the REAL decision path:
//
//   POST /api/sensors (sim)  →  5s pump / forced tick  →  Collect Data
//     →  Main Logic  →  → Gree Command  →  gree-hvac node  →  UDP  →  simulator
//
// and asserts the resulting AC state at the sim plus the controller's published
// decision (global controllerStatus, surfaced by the GET /test/status hook).
//
// Time-of-day and the debounce delays are made test-fast via the sim-only
// hooks on the mocks tab: POST /test sets global.simClock (already honoured by
// Main Logic) and global.test (config delay overrides + manualMode), both inert
// in production when unset.

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureStack, teardownStack } = require('./global-setup');
const { get, postJson, waitFor, sleep } = require('./harness');

const NR = 'http://127.0.0.1:1880';
const SIM = 'http://127.0.0.1:8080';

// Shrink every debounce so transitions happen in a couple of ticks.
const FAST = { onDelay: 1, offDelay: 1, minOnTime: 1, minOffTime: 1 };
// Sensors that satisfy every ON condition (mild outside → no threshold adjust).
const SURPLUS = {
    soc: 80,
    batteryVoltage: 54,
    batterySystemStateNum: 1, // charging → PV surplus
    insideC: 28,
    outsideC: 25,
};
// Sensors that block on every axis (low SOC, low voltage, discharging, cool).
// Both temps sit below their OR thresholds (inside < 20, outside < 24).
const BLOCKING = {
    soc: 0,
    batteryVoltage: 50,
    batterySystemStateNum: 2,
    insideC: 18,
    outsideC: 18,
};

const setTest = body => postJson(`${NR}/test`, body);
const setSensors = body => postJson(`${SIM}/api/sensors`, body);
const simState = async () => JSON.parse((await get(`${SIM}/api/state`)).body);
const status = async () => JSON.parse((await get(`${NR}/test/status`)).body);
// Force one evaluation immediately instead of waiting for the 5s pump.
const pump = () => postJson(`${NR}/inject/mock-tick`, {});

// Pump-and-poll until the simulated AC reaches the wanted power state.
const waitForPower = (want, label) =>
    waitFor(
        async () => {
            await pump();
            return (await simState()).friendly.power === want;
        },
        { timeout: 45000, interval: 1500, label }
    );

// Unique token per baseline so the one-shot acState reset re-fires each time.
let resetSeq = 0;

// Known baseline: fast delays, real-ish midday, automatic mode, AC off, and
// the controller's belief reset to OFF. Forcing the sim off too keeps the
// controller's acState and the sim's real power in sync — other e2e files set
// the sim power directly, which would otherwise desync the two (the controller
// only commands on a transition, so it can't bridge a mismatch on its own).
const baseline = async () => {
    resetSeq += 1;
    await setTest({
        config: FAST,
        manualMode: false,
        simClock: { enabled: true, hour: 12 },
        resetNonce: `r${resetSeq}`,
    });
    await postJson(`${SIM}/api/set`, { Pow: 0 });
    await setSensors(BLOCKING);
    await waitForPower('off', 'baseline AC off');
};

test.before(async () => {
    await ensureStack({ skipBuild: process.env.E2E_SKIP_BUILD === '1' });
});

test.after(async () => {
    // Clear overrides so the leftover state can't fight other e2e files: real
    // clock, no config/manual override, blocking sensors keep the AC off.
    try {
        await setTest({ simClock: { enabled: false } });
        await setSensors(BLOCKING);
    } catch (_) {
        /* best-effort */
    }
    if (process.env.E2E_KEEP_UP === '1') return;
    await teardownStack();
});

test('the /test hooks are reachable and shape state', async () => {
    const r = await setTest({
        config: FAST,
        manualMode: false,
        simClock: { enabled: true, hour: 12 },
    });
    assert.equal(r.status, 200);
    const s = await status();
    assert.equal(s.simClock.enabled, true);
    assert.equal(s.simClock.hour, 12);
    assert.deepEqual(s.test.config, FAST);
});

test('ON path: PV surplus + warm room turns the AC on with a full cool set', async () => {
    await baseline();

    await setSensors(SURPLUS);
    await waitForPower('on', 'AC on from surplus');

    const s = await simState();
    assert.equal(s.friendly.power, 'on');
    assert.equal(s.friendly.mode, 'cool');
    assert.equal(s.friendly.temperature, 23); // config.targetTemp

    const ctrl = (await status()).controllerStatus;
    assert.equal(ctrl.phase, 'on');
});

test('OFF path: SOC dropping below the keep-threshold turns the AC off', async () => {
    await baseline();
    await setSensors(SURPLUS);
    await waitForPower('on', 'AC on before off test');

    // Drop SOC below socOffThreshold (65) — everything else still fine.
    // (waitForPower already proves the AC shut down in response.)
    await setSensors({ soc: 60 });
    await waitForPower('off', 'AC off after SOC drop');

    // `off` is a one-shot transition phase; by the time the sim reports the AC
    // off the controller has usually settled into `idle` (off + SOC blocking).
    const ctrl = (await status()).controllerStatus;
    assert.ok(
        ['off', 'disarming', 'idle'].includes(ctrl.phase),
        `expected a non-running phase, got ${ctrl.phase}`
    );
    assert.match(ctrl.message, /SOC/);
});

test('quiet hours block: outside the operating window the AC stays off', async () => {
    await baseline();

    // 22:00 is outside the 09–19 window; surplus otherwise.
    await setTest({
        config: FAST,
        manualMode: false,
        simClock: { enabled: true, hour: 22 },
    });
    await setSensors(SURPLUS);

    for (let i = 0; i < 4; i++) {
        await pump();
        await sleep(800);
        assert.equal(
            (await simState()).friendly.power,
            'off',
            `AC must stay off in quiet hours (tick ${i})`
        );
    }
    const ctrl = (await status()).controllerStatus;
    assert.equal(ctrl.phase, 'idle');
    assert.match(ctrl.message, /quiet hours/);
});

test('manual mode: the controller stands down and never commands the AC', async () => {
    await baseline();

    await setTest({
        config: FAST,
        manualMode: true,
        simClock: { enabled: true, hour: 12 },
    });
    await setSensors(SURPLUS); // would turn on in automatic mode

    for (let i = 0; i < 4; i++) {
        await pump();
        await sleep(800);
        assert.equal(
            (await simState()).friendly.power,
            'off',
            `controller must not drive the AC in manual mode (tick ${i})`
        );
    }
    const ctrl = (await status()).controllerStatus;
    assert.equal(ctrl.phase, 'manual');
});
