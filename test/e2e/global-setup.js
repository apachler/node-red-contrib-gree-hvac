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
    try {
        await down();
    } catch (e) {
        /* best-effort */
    }
}

module.exports = { ensureStack, teardownStack };
