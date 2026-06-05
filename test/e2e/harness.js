'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMPOSE = ['compose', '-f', path.join(REPO_ROOT, 'docker-compose.yml')];

/**
 *
 * @param args
 * @param opts
 */
function run(args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('docker', args, {
            stdio: opts.stdio || 'inherit',
            cwd: REPO_ROOT,
            ...opts.spawn,
        });
        child.on('exit', code => {
            if (code === 0) resolve();
            else reject(new Error(`docker ${args.join(' ')} exited ${code}`));
        });
        child.on('error', reject);
    });
}

/**
 * @param args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runSync(args) {
    const r = spawnSync('docker', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 *
 * @param root0
 * @param root0.build
 */
async function up({ build = true } = {}) {
    if (build) {
        await run([...COMPOSE, 'build']);
    }
    await run([...COMPOSE, 'up', '-d']);
}

/**
 *
 */
async function down() {
    await run([...COMPOSE, 'down', '-v', '--remove-orphans']);
}

/**
 *
 */
async function dumpLogs() {
    try {
        await run([...COMPOSE, 'logs', '--tail=200']);
    } catch (_) {
        /* best-effort */
    }
}

/**
 * @returns {boolean}
 */
function dockerCliAvailable() {
    const r = spawnSync('docker', ['version'], { encoding: 'utf8' });
    return r.status === 0;
}

/**
 * @param url
 * @param opts
 * @returns {Promise<{status: number, body: string}>}
 */
function get(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, opts, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', c => (data += c));
            res.on('end', () =>
                resolve({ status: res.statusCode, body: data })
            );
        });
        req.on('error', reject);
        req.setTimeout(opts.timeout || 5000, () =>
            req.destroy(new Error('timeout'))
        );
    });
}

/**
 * @param url
 * @param body
 * @returns {Promise<{status: number, body: string}>}
 */
function postJson(url, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const payload = Buffer.from(JSON.stringify(body));
        const req = http.request(
            {
                method: 'POST',
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': payload.length,
                },
            },
            res => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', c => (data += c));
                res.on('end', () =>
                    resolve({ status: res.statusCode, body: data })
                );
            }
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

/**
 * @param check
 * @param opts
 * @returns {Promise<void>}
 */
async function waitFor(check, opts = {}) {
    const timeout = opts.timeout || 60000;
    const interval = opts.interval || 1000;
    const label = opts.label || 'condition';
    const start = Date.now();
    let lastErr = null;
    while (Date.now() - start < timeout) {
        try {
            if (await check()) return;
        } catch (e) {
            lastErr = e;
        }
        await sleep(interval);
    }
    throw new Error(
        `timed out after ${timeout}ms waiting for ${label}` +
            (lastErr ? ` (last error: ${lastErr.message})` : '')
    );
}

/**
 * @param ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 *
 */
async function waitForSimReady() {
    await waitFor(
        async () => {
            const r = await get('http://127.0.0.1:8080/api/state');
            return r.status === 200;
        },
        { timeout: 60000, interval: 1000, label: 'sim http' }
    );
}

/**
 *
 */
async function waitForNodeRedReady() {
    await waitFor(
        async () => {
            const r = await get('http://127.0.0.1:1880/');
            return r.status === 200;
        },
        { timeout: 120000, interval: 1500, label: 'node-red http' }
    );
    // give the runtime an extra moment to deploy flows
    await sleep(2000);
}

module.exports = {
    up,
    down,
    dumpLogs,
    dockerCliAvailable,
    get,
    postJson,
    waitFor,
    waitForSimReady,
    waitForNodeRedReady,
    sleep,
    runSync,
    COMPOSE,
};
