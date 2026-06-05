'use strict';

// Flow-logic test harness.
//
// Runs the REAL function-node code from docker/nodered/flows.user.json in a
// faked Node-RED runtime, so these tests exercise the exact logic shipped in
// the flow (no copy — extracted by node name at load time, fails on drift).
//
// The two things that make the controller hard to test are made controllable
// here:
//   * time-of-day  — via the global `simClock` (already a flow hook), or the
//                    fake clock's hour.
//   * Date.now()   — the onDelay/offDelay/minOnTime/minOffTime debounces read
//                    real wall-clock in production; here a fake `Date` lets a
//                    test advance seconds instantly.

const fs = require('node:fs');
const path = require('node:path');

const FLOW_PATH = path.join(
    __dirname,
    '..',
    '..',
    'docker',
    'nodered',
    'flows.user.json'
);

// Node names of the four function nodes that make up the control pipeline.
const NODES = {
    configInit: 'Config Init',
    collect: 'Collect Data',
    logic: 'Main Logic',
    command: '→ Gree Command',
};

// Maps the flat sensor object (as served by the sim's /api/sensors) to the
// `msg.path` values that 'Collect Data' dispatches on — mirrors the mock
// fan-out in flows.mocks.json.
const SENSOR_PATHS = {
    soc: 'Battery SOC',
    batterySystemStateNum: 'Battery State',
    batteryVoltage: 'Battery Voltage',
    insideC: 'Ruuvi Inside',
    outsideC: 'Ruuvi Outside',
};

const loadFlowFunctions = (flowPath = FLOW_PATH) => {
    const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
    const byName = {};
    for (const n of flow) {
        if (n.type === 'function' && n.name) {
            byName[n.name] = n;
        }
    }
    for (const [, name] of Object.entries(NODES)) {
        if (!byName[name]) {
            throw new Error(`flow function node not found: "${name}"`);
        }
    }
    return byName;
};

// In-memory stand-in for a Node-RED context (flow/global). Honours the
// optional store-name argument ('persistent') as a separate scope, which is
// exactly how Config Init / Save Config use it.
const makeStore = () => {
    const scopes = { default: new Map(), persistent: new Map() };
    const scope = name => scopes[name] || scopes.default;
    return {
        get(key, store) {
            return scope(store).get(key);
        },
        set(key, value, store) {
            scope(store).set(key, value);
        },
    };
};

// A fake Date: Date.now() and getHours() are driven by an advanceable clock,
// so debounce timers collapse to instant and the time-of-day gate is fixed.
// Base epoch is a real, non-zero timestamp on purpose: Main Logic stores
// `conditionsMetSince = Date.now()` and later tests it with `if (!...Since)`.
// At ms=0 that timestamp would be falsy and the debounce would never settle —
// exactly the bug a zero-based clock would mask.
const makeClock = ({ ms = 1_700_000_000_000, hour = 12 } = {}) => {
    const state = { ms, hour };
    const RealDate = Date;
    // Must be newable (the flow calls `new Date()`), so a function expression
    // rather than an arrow. Returns a real Date instance with getHours pinned.
    const FakeDate = function (...args) {
        const real = args.length
            ? new RealDate(...args)
            : new RealDate(state.ms);
        real.getHours = () => state.hour;
        return real;
    };
    FakeDate.now = () => state.ms;
    return {
        Date: FakeDate,
        advance(seconds) {
            state.ms += seconds * 1000;
            return this;
        },
        setHour(h) {
            state.hour = h;
            return this;
        },
        now() {
            return state.ms;
        },
    };
};

const createController = (opts = {}) => {
    const fns = loadFlowFunctions(opts.flowPath);
    const flow = makeStore();
    const global = makeStore();
    const context = makeStore();
    const clock = makeClock(opts.clock);

    const statuses = [];
    const node = {
        status: s => statuses.push(s),
        warn() {},
        error() {},
        log() {},
        send() {},
    };
    const env = { get: () => undefined };
    const RED = { util: {} };

    // Compile + run a flow function node by its logical key.
    const run = (key, msg) => {
        const def = fns[NODES[key]];
        // Function-node body sees: msg, node, flow, global, context, RED, env,
        // and a shadowed Date (the only globals these nodes touch).
        const fn = new Function(
            'msg',
            'node',
            'flow',
            'global',
            'context',
            'RED',
            'env',
            'Date',
            def.func
        );
        return fn.call(
            node,
            msg,
            node,
            flow,
            global,
            context,
            RED,
            env,
            clock.Date
        );
    };

    const api = {
        // Seed config + acState + currentValues. Pass a patch to override
        // specific defaults (written to the 'persistent' store, the same path
        // Save Config uses, then merged by Config Init).
        init(configPatch) {
            if (configPatch) {
                flow.set('config', { ...configPatch }, 'persistent');
            }
            run('configInit', {});
            return api;
        },

        // Push sensor readings through Collect Data. Accepts a partial set;
        // only provided keys are dispatched.
        feed(sensors) {
            for (const [key, sensorPath] of Object.entries(SENSOR_PATHS)) {
                if (sensors[key] !== undefined) {
                    run('collect', { path: sensorPath, payload: sensors[key] });
                }
            }
            return api;
        },

        // Run one Main Logic evaluation; if it emits a decision, pipe it
        // through → Gree Command. Returns everything a test wants to assert.
        evaluate() {
            const decision = run('logic', {});
            const command = decision ? run('command', decision) : null;
            return {
                decision,
                command,
                controllerStatus: global.get('controllerStatus'),
                acState: api.acState(),
                currentValues: api.currentValues(),
            };
        },

        // Drive the AC on the way the controller really does it: one
        // evaluation to arm (record conditionsMetSince), advance past onDelay,
        // then a second evaluation that emits the ON command. Assumes the fed
        // sensors already satisfy every start condition.
        bringOnline() {
            api.evaluate();
            api.advance((api.config().onDelay || 0) + 1);
            return api.evaluate();
        },

        setSimClock(simClock) {
            global.set('simClock', simClock);
            return api;
        },
        setHour(hour) {
            clock.setHour(hour);
            return api;
        },
        setManual(manualMode) {
            const state = flow.get('acState') || {};
            state.manualMode = manualMode;
            flow.set('acState', state);
            return api;
        },
        advance(seconds) {
            clock.advance(seconds);
            return api;
        },

        config: () => flow.get('config'),
        acState: () => flow.get('acState'),
        currentValues: () => flow.get('currentValues'),
        controllerStatus: () => global.get('controllerStatus'),
        statuses: () => statuses,
    };

    return api;
};

// Convenience: a sensor set that satisfies every ON condition with the
// default config (both temperature arms of the OR gate are satisfied).
const surplusSensors = (overrides = {}) => ({
    soc: 75,
    batteryVoltage: 54,
    batterySystemStateNum: 1, // charging → PV surplus
    insideC: 27, // >= insideOnThreshold (20)
    outsideC: 25, // >= outsideOnThreshold (24)
    ...overrides,
});

module.exports = { createController, surplusSensors, FLOW_PATH, NODES };
