'use strict';

/**
 * Push the repo's source flows into the RUNNING Node-RED editor without a
 * rebuild. Merges flows.user.json + flows.mocks.json the same way
 * merge-flows.js does, then full-deploys the result over the admin API
 * (POST /flows). Node-RED loads it immediately and persists it to /data,
 * so an open editor just needs a browser refresh.
 *
 * This is the fast inner loop for editing the flow source files on the
 * host: edit -> `npm run flow:push` -> refresh the editor. A rebuild
 * (`npm run sim:dev`) is only needed when the contrib node code or the
 * image itself changes.
 *
 * Usage:
 *   node docker/nodered/push-flows.js          # merge sources + deploy
 *   node docker/nodered/push-flows.js user     # deploy user flow only *
 *
 * (*) "user" still deploys the full set but omits the mocks tab; use it
 *     only if you deliberately want the sim stack without the mock nodes.
 *
 * Env:
 *   NR_URL   Node-RED base url (default http://127.0.0.1:1880)
 */

const fs = require('fs');
const path = require('path');

const NR_URL = (process.env.NR_URL || 'http://127.0.0.1:1880').replace(
    /\/$/,
    ''
);
// Validate the env-supplied base URL (plain http(s) origin, no path/query) so
// the deploy request below has a sanitized, non-tainted target.
if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(NR_URL)) {
    throw new Error(`invalid NR_URL: ${NR_URL}`);
}
const HERE = __dirname;
const USER_PATH = path.join(HERE, 'flows.user.json');
const MOCKS_PATH = path.join(HERE, 'flows.mocks.json');

/**
 * @param {string} p
 * @returns {object[]}
 */
function readFlow(p) {
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(arr)) throw new Error(`${p} is not a flow array`);
    return arr;
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    const target = (process.argv[2] || 'both').toLowerCase();
    if (!['both', 'user'].includes(target)) {
        console.error('usage: node push-flows.js [both|user]');
        process.exit(2);
    }

    const user = readFlow(USER_PATH);
    let merged = user;
    if (target === 'both') {
        const mocks = readFlow(MOCKS_PATH);
        const userIds = new Set(user.map(n => n.id));
        const collisions = mocks.map(n => n.id).filter(id => userIds.has(id));
        if (collisions.length) {
            throw new Error(
                `id collision user/mocks: ${collisions.join(', ')}`
            );
        }
        merged = user.concat(mocks);
    }

    const res = await fetch(`${NR_URL}/flows`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Node-RED-Deployment-Type': 'full',
        },
        body: JSON.stringify(merged),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(
            `POST ${NR_URL}/flows -> ${res.status} ${txt.slice(0, 200)}`
        );
    }

    console.log(
        `[push-flows] deployed ${merged.length} nodes to ${NR_URL} (${target}). ` +
            'Refresh the editor to see it.'
    );
}

main().catch(err => {
    console.error('[push-flows]', err.message);
    process.exit(1);
});
