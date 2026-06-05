'use strict';

/**
 * E2E runner: owns the docker-compose stack lifecycle ONCE for the whole
 * suite, then runs the test files against the shared stack.
 *
 * Why this exists: `node --test test/e2e/*.e2e.test.js` runs each file in
 * its own child process. If every file called `docker compose up` from a
 * before() hook they would collide on container names, the network, and
 * host ports. So the runner brings the stack up, sets E2E_STACK_UP=1, runs
 * the test files (their ensureStack() then only waits for readiness), and
 * tears down once at the end.
 *
 * Env:
 *   E2E_SKIP_BUILD=1  reuse existing images (skip `docker compose build`)
 *   E2E_KEEP_UP=1     leave the stack running after the suite finishes
 */

const { spawn } = require('child_process');
const path = require('path');
const {
    up,
    down,
    dumpLogs,
    dockerCliAvailable,
    waitForSimReady,
    waitForNodeRedReady,
} = require('./harness');

const REPO_ROOT = path.join(__dirname, '..', '..');

/**
 * @param {string[]} args
 * @param {object} env
 * @returns {Promise<number>} child exit code
 */
function runNodeTest(args, env) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, args, {
            stdio: 'inherit',
            cwd: REPO_ROOT,
            env,
        });
        child.on('exit', code => resolve(code == null ? 1 : code));
        child.on('error', () => resolve(1));
    });
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    if (!dockerCliAvailable()) {
        console.error(
            '[e2e] docker CLI is not available — e2e tests require docker compose'
        );
        process.exit(1);
    }

    const skipBuild = process.env.E2E_SKIP_BUILD === '1';
    const keepUp = process.env.E2E_KEEP_UP === '1';

    console.log(
        `[e2e] bringing stack up (build=${!skipBuild})… this is slow on first run`
    );
    await up({ build: !skipBuild });

    let exitCode = 1;
    try {
        await waitForSimReady();
        await waitForNodeRedReady();
        console.log('[e2e] stack ready — running test files');

        // --test-concurrency=1 runs the test files one at a time. They share
        // a single sim, and fault-recovery.e2e.test.js injects packet drops
        // that would break the other files' assertions if they ran in
        // parallel against the same container.
        // No --test-timeout: it's Node 20+ only and the e2e CI floor is Node
        // 18, which rejects the flag. The test files carry their own waits and
        // the e2e CI job has a timeout-minutes cap as the safety net.
        exitCode = await runNodeTest(
            ['--test', '--test-concurrency=1', 'test/e2e/*.e2e.test.js'],
            { ...process.env, E2E_STACK_UP: '1' }
        );
    } catch (err) {
        console.error('[e2e] stack failed to become ready:', err.message);
        await dumpLogs();
        exitCode = 1;
    } finally {
        if (keepUp) {
            console.log('[e2e] E2E_KEEP_UP=1 — leaving stack running');
        } else {
            console.log('[e2e] tearing down stack');
            await down().catch(() => {});
        }
    }

    process.exit(exitCode);
}

main().catch(err => {
    console.error('[e2e] fatal:', err);
    process.exit(1);
});
