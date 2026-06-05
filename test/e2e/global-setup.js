'use strict';

const {
    up,
    down,
    dumpLogs,
    dockerCliAvailable,
    waitForSimReady,
    waitForNodeRedReady,
} = require('./harness');

let started = false;

/**
 *
 * @param root0
 * @param root0.skipBuild
 */
async function ensureStack({ skipBuild = false } = {}) {
    if (!dockerCliAvailable()) {
        throw new Error(
            'docker CLI is not available — e2e tests require docker compose'
        );
    }
    if (started) return;

    // When launched via the e2e runner (run-e2e.js), the stack is already
    // up and the runner owns its lifecycle. Each test file runs in its own
    // process, so we just confirm readiness here instead of racing multiple
    // `docker compose up` invocations against the same container names.
    if (process.env.E2E_STACK_UP === '1') {
        await waitForSimReady();
        await waitForNodeRedReady();
        started = true;
        return;
    }

    await up({ build: !skipBuild });
    try {
        await waitForSimReady();
        await waitForNodeRedReady();
    } catch (e) {
        await dumpLogs();
        await down();
        throw e;
    }
    started = true;
}

/**
 *
 */
async function teardownStack() {
    if (!started) return;
    started = false;
    // The runner owns teardown when it brought the stack up; tearing down
    // here would kill the stack out from under the other test files still
    // running in parallel processes.
    if (process.env.E2E_STACK_UP === '1') return;
    try {
        await down();
    } catch (e) {
        /* best-effort */
    }
}

module.exports = { ensureStack, teardownStack };
