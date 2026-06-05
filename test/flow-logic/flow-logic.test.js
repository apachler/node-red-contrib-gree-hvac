'use strict';

// Logic-level tests for the Gree PV-surplus flow. These run the actual
// function-node code extracted from docker/nodered/flows.user.json (see
// sandbox.js), driving the controller with a fake clock so the real 60s/300s
// debounces are exercised in microseconds.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createController, surplusSensors } = require('./sandbox');

// Stand the controller up in a known state: config seeded, in the operating
// window via simClock, AC off. Returns the controller.
const freshController = configPatch => {
    const c = createController();
    c.init(configPatch);
    c.setSimClock({ enabled: true, hour: 12 });
    return c;
};

test('Config Init seeds defaults + baseline state', () => {
    const c = createController().init();
    const cfg = c.config();
    assert.equal(cfg.targetTemp, 23);
    assert.equal(cfg.insideOnThreshold, 20);
    assert.equal(cfg.outsideOnThreshold, 24);
    assert.equal(cfg.socOnThreshold, 70);
    assert.equal(cfg.socOffThreshold, 65);
    assert.equal(cfg.voltageOnThreshold, 53.5);
    assert.equal(cfg.onDelay, 60);

    const state = c.acState();
    assert.equal(state.power, false);
    assert.equal(state.manualMode, false);

    // A patch overrides only the named default.
    const c2 = createController().init({ onDelay: 1, targetTemp: 21 });
    assert.equal(c2.config().onDelay, 1);
    assert.equal(c2.config().targetTemp, 21);
    assert.equal(c2.config().insideOnThreshold, 20); // untouched default
});

test('Collect Data classifies battery voltage into charge stages', () => {
    const c = createController().init();

    c.feed({ batteryVoltage: 56.5 });
    assert.equal(c.currentValues().batteryState, 'Absorption');

    c.feed({ batteryVoltage: 54 });
    assert.equal(c.currentValues().batteryState, 'Float');

    c.feed({ batteryVoltage: 50 });
    assert.equal(c.currentValues().batteryState, 'Bulk');

    c.feed({ batteryVoltage: 0 });
    assert.equal(c.currentValues().batteryState, 'Unknown');
});

test('Collect Data maps each sensor path and sets received flags', () => {
    const c = createController().init();
    c.feed(
        surplusSensors({
            insideC: 24.5,
            outsideC: 18.2,
            batterySystemStateNum: 2,
        })
    );

    const v = c.currentValues();
    assert.equal(v.soc, 75);
    assert.equal(v.batteryVoltage, 54);
    assert.equal(v.batterySystemStateNum, 2);
    assert.equal(v.batterySystemState, 'Discharging');
    assert.equal(v.temperature, 24.5);
    assert.equal(v.tempReceived, true);
    assert.equal(v.outsideTemp, 18.2);
    assert.equal(v.outsideTempReceived, true);
});

test('ON path: arms for onDelay, then commands a full cool set', () => {
    const c = freshController();
    c.feed(surplusSensors());

    // Conditions just met → arming, no command yet.
    let r = c.evaluate();
    assert.equal(r.decision, null);
    assert.equal(r.controllerStatus.phase, 'arming');
    assert.equal(r.acState.power, false);

    // Before onDelay elapses, still arming.
    c.advance(59);
    r = c.evaluate();
    assert.equal(r.decision, null);
    assert.equal(r.controllerStatus.phase, 'arming');

    // Past onDelay → turns on with the complete parameter set.
    c.advance(2);
    r = c.evaluate();
    assert.ok(r.decision, 'expected an ON decision');
    assert.equal(r.decision.payload.action, 'on');
    assert.equal(r.acState.power, true);

    assert.equal(r.command.topic, 'on');
    assert.equal(r.command.payload.power, 'on');
    assert.equal(r.command.payload.mode, 'cool');
    assert.equal(r.command.payload.temperature, 23);
    assert.equal(r.command.payload.fanSpeed, 'auto');
    assert.equal(r.command.payload.blow, 'on');
});

test('OFF path: SOC drops below keep-threshold, holds minOnTime, then off', () => {
    const c = freshController();
    c.feed(surplusSensors());
    c.bringOnline(); // now ON (lastOnAt recorded)

    // SOC falls below socOffThreshold while still inside minOnTime.
    c.feed({ soc: 64 });
    let r = c.evaluate();
    assert.equal(r.decision, null);
    assert.equal(r.controllerStatus.phase, 'on'); // holding for compressor
    assert.equal(r.acState.power, true);

    // Past minOnTime: starts the offDelay countdown.
    c.advance(301);
    r = c.evaluate();
    assert.equal(r.decision, null);
    assert.equal(r.controllerStatus.phase, 'disarming');

    // Past offDelay → off.
    c.advance(61);
    r = c.evaluate();
    assert.ok(r.decision, 'expected an OFF decision');
    assert.equal(r.decision.payload.action, 'off');
    assert.equal(r.acState.power, false);
    assert.equal(r.command.payload.power, 'off');
    assert.equal(r.command.payload.mode, 'cool'); // full set still asserted
});

test('SOC hysteresis: keeps running between off- and on-thresholds', () => {
    const c = freshController();
    c.feed(surplusSensors());
    c.bringOnline(); // ON

    // 67% is below the 70% start gate but above the 65% keep gate.
    c.feed({ soc: 67 });
    c.advance(400);
    const r = c.evaluate();
    assert.equal(r.acState.power, true);
    assert.equal(r.controllerStatus.phase, 'on');
});

test('manual mode: controller stands down regardless of conditions', () => {
    const c = freshController();
    c.setManual(true);
    c.feed(surplusSensors());
    c.advance(120);
    const r = c.evaluate();
    assert.equal(r.decision, null);
    assert.equal(r.controllerStatus.phase, 'manual');
    assert.equal(r.acState.power, false);
});

test('quiet hours block: outside the operating window the AC never arms', () => {
    const c = freshController();
    c.setSimClock({ enabled: true, hour: 21 });
    c.feed(surplusSensors());
    c.advance(600);
    const r = c.evaluate();
    assert.equal(r.decision, null);
    assert.equal(r.controllerStatus.phase, 'idle');
    assert.match(r.controllerStatus.message, /quiet hours/);
});

test('voltage gate: below voltageOnThreshold blocks start', () => {
    const c = freshController();
    c.feed(surplusSensors({ batteryVoltage: 53.0 }));
    c.advance(120);
    const r = c.evaluate();
    assert.equal(r.decision, null);
    assert.equal(r.controllerStatus.phase, 'idle');
    assert.match(r.controllerStatus.message, /53\.0+V < 53\.5V/);
});

test('battery discharging blocks start (no PV surplus)', () => {
    const c = freshController();
    c.feed(surplusSensors({ batterySystemStateNum: 2 }));
    c.advance(120);
    const r = c.evaluate();
    assert.equal(r.decision, null);
    assert.match(r.controllerStatus.message, /discharging/);
});

test('SOC below start-threshold blocks start', () => {
    const c = freshController();
    c.feed(surplusSensors({ soc: 69 }));
    c.advance(120);
    const r = c.evaluate();
    assert.equal(r.decision, null);
    assert.match(r.controllerStatus.message, /SOC 69% < 70%/);
});

test('temp gate (inside arm): warm room starts the AC even when outside is cool', () => {
    const c = freshController();
    // inside 22 ≥ insideOnThreshold (20); outside 10 < outsideOnThreshold (24).
    const r = c
        .feed(surplusSensors({ insideC: 22, outsideC: 10 }))
        .bringOnline();
    assert.ok(r.decision, 'expected ON from the inside arm');
    assert.equal(r.decision.payload.action, 'on');
});

test('temp gate (outside arm): hot outside pre-cools even when inside is below the inside threshold', () => {
    const c = freshController();
    // inside 18 < insideOnThreshold (20); outside 26 ≥ outsideOnThreshold (24).
    const r = c
        .feed(surplusSensors({ insideC: 18, outsideC: 26 }))
        .bringOnline();
    assert.ok(r.decision, 'expected ON from the outside arm');
    assert.equal(r.decision.payload.action, 'on');
});

test('temp gate: blocked only when BOTH inside and outside are below their thresholds', () => {
    const c = freshController();
    // inside 18 < 20 AND outside 20 < 24 → neither arm fires.
    c.feed(surplusSensors({ insideC: 18, outsideC: 20 }));
    c.advance(120);
    const r = c.evaluate();
    assert.equal(r.decision, null);
    assert.match(
        r.controllerStatus.message,
        /inside 18\.0°C < 20°C & outside 20\.0°C < 24°C/
    );
});

test('minOffTime: compressor cooldown blocks an immediate restart', () => {
    const c = freshController();

    // Turn on, then force off via SOC drop past minOnTime + offDelay.
    c.feed(surplusSensors());
    c.bringOnline(); // ON
    c.feed({ soc: 64 });
    c.advance(301);
    c.evaluate(); // disarming
    c.advance(61);
    let r = c.evaluate(); // OFF (lastOffAt recorded)
    assert.equal(r.acState.power, false);

    // Conditions immediately good again, but cooldown blocks the restart.
    c.feed(surplusSensors());
    c.advance(61); // past onDelay but not minOffTime (180s)
    r = c.evaluate();
    assert.equal(r.decision, null);
    assert.equal(r.controllerStatus.phase, 'blocked');

    // Past minOffTime → it can arm and restart.
    c.advance(180);
    r = c.bringOnline();
    assert.ok(r.decision, 'expected restart after cooldown');
    assert.equal(r.decision.payload.action, 'on');
});
