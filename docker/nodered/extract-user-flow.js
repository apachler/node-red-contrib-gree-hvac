'use strict';

/**
 * Reverse of merge-flows.js: pull the flow you edited in the running
 * Node-RED editor back into the repo's flows.user.json — WITHOUT the
 * simulator-only mock nodes.
 *
 * The container runs the merged flow (flows.user.json + flows.mocks.json,
 * concatenated by merge-flows.js). To recover just the user flow we fetch
 * the deployed flow from the admin API and drop every node whose id is
 * present in flows.mocks.json.
 *
 * Usage (after you Deploy in the editor):
 *   node docker/nodered/extract-user-flow.js
 *
 * Env:
 *   NR_URL   Node-RED base url (default http://127.0.0.1:1880)
 *
 * It writes docker/nodered/flows.user.json in place. Review with `git diff`
 * before committing. Mock nodes are never written here — edit those in
 * flows.mocks.json instead.
 */

const fs = require('fs');
const path = require('path');

const NR_URL = (process.env.NR_URL || 'http://127.0.0.1:1880').replace(
    /\/$/,
    ''
);
const HERE = __dirname;
const MOCKS_PATH = path.join(HERE, 'flows.mocks.json');
const USER_PATH = path.join(HERE, 'flows.user.json');

/**
 * @returns {Promise<void>}
 */
async function main() {
    const mocks = JSON.parse(fs.readFileSync(MOCKS_PATH, 'utf8'));
    const mockIds = new Set(mocks.map(n => n.id));

    const res = await fetch(`${NR_URL}/flows`, {
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
        throw new Error(`GET ${NR_URL}/flows -> ${res.status}`);
    }
    const body = await res.json();
    // The admin API returns either a bare array or {rev, flows} depending
    // on the Node-RED-API-Version. Handle both.
    const deployed = Array.isArray(body) ? body : body.flows;
    if (!Array.isArray(deployed)) {
        throw new Error('unexpected /flows response shape');
    }

    const userNodes = deployed.filter(n => !mockIds.has(n.id));
    const dropped = deployed.length - userNodes.length;

    // Node-RED returns nodes in deploy order, which differs from the file.
    // Re-order to match the existing flows.user.json so a small edit shows
    // as a small diff. Nodes not seen before are appended in deploy order.
    let ordered = userNodes;
    if (fs.existsSync(USER_PATH)) {
        const prev = JSON.parse(fs.readFileSync(USER_PATH, 'utf8'));
        const rank = new Map(prev.map((n, i) => [n.id, i]));
        ordered = userNodes
            .map((n, i) => ({ n, i }))
            .sort((a, b) => {
                const ra = rank.has(a.n.id) ? rank.get(a.n.id) : Infinity;
                const rb = rank.has(b.n.id) ? rank.get(b.n.id) : Infinity;
                return ra - rb || a.i - b.i;
            })
            .map(x => x.n);
    }

    fs.writeFileSync(USER_PATH, JSON.stringify(ordered, null, 4) + '\n');
    console.log(
        `[extract-user-flow] wrote ${USER_PATH} ` +
            `(${userNodes.length} user nodes, dropped ${dropped} mock nodes)`
    );
    console.log('[extract-user-flow] review with `git diff` before committing.');
}

main().catch(err => {
    console.error('[extract-user-flow]', err.message);
    process.exit(1);
});
