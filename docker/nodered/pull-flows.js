'use strict';

/**
 * Reverse of merge-flows.js: pull the flow you edited in the running
 * Node-RED editor back into the repo's source files — splitting it into the
 * production flow (flows.user.json) and the simulator-only mocks tab
 * (flows.mocks.json).
 *
 * The container runs the MERGED flow (flows.user.json + flows.mocks.json,
 * concatenated by merge-flows.js). To recover the sources we fetch the
 * deployed flow and partition every node into "user" vs "mock":
 *
 *   - the mocks tab itself + every node on it (z === 'mocks-tab')  -> mock
 *   - config nodes reachable ONLY from mock nodes                  -> mock
 *   - config nodes reachable from a user node (e.g. the shared
 *     ui-base / ui-theme) stay with the user flow so the production
 *     file remains standalone and the two files never collide on id
 *   - everything else                                              -> user
 *
 * This is more robust than a static id list: nodes you ADD to the mocks
 * tab in the editor are classified by where they live, not by whether they
 * already existed in flows.mocks.json.
 *
 * Usage (after you Deploy in the editor):
 *   node docker/nodered/pull-flows.js            # writes both files
 *   node docker/nodered/pull-flows.js user       # only flows.user.json
 *   node docker/nodered/pull-flows.js mocks      # only flows.mocks.json
 *
 * Env:
 *   NR_URL     Node-RED base url (default http://127.0.0.1:1880)
 *   FLOW_FILE  read a flows.json from disk instead of the admin API
 *   OUT_DIR    write the split files here (default this script's dir)
 *
 * Review with `git diff` before committing. A round-trip introduces some
 * harmless Node-RED normalisation (node re-ordering is undone here; it also
 * clamps long comment positions, drops redundant `outputs`, and adds an
 * empty trailing output array). None of it changes behaviour.
 */

const fs = require('fs');
const path = require('path');

const NR_URL = (process.env.NR_URL || 'http://127.0.0.1:1880').replace(
    /\/$/,
    ''
);
const HERE = __dirname;
const OUT_DIR = process.env.OUT_DIR || HERE;
const MOCKS_PATH = path.join(OUT_DIR, 'flows.mocks.json');
const USER_PATH = path.join(OUT_DIR, 'flows.user.json');
const MOCK_TAB = 'mocks-tab';

// Free-text / code properties never hold a structural config reference, and
// scanning them risks a false match against an id mentioned in a comment or
// function body. Skip them when collecting references.
const TEXT_KEYS = new Set(['func', 'initialize', 'finalize', 'info']);

/**
 * Collect the config-node ids a node references (deep scan of structural
 * string values).
 * @param {object} node
 * @param {Set<string>} configIds
 * @returns {Set<string>}
 */
function refsOf(node, configIds) {
    const out = new Set();
    (function walk(value, key) {
        if (value == null) return;
        if (typeof value === 'string') {
            if (configIds.has(value)) out.add(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(v => walk(v, key));
            return;
        }
        if (typeof value === 'object') {
            for (const k of Object.keys(value)) {
                if (k === 'id' || k === 'z' || k === 'wires') continue;
                if (TEXT_KEYS.has(k)) continue;
                walk(value[k], k);
            }
        }
    })(node);
    out.delete(node.id);
    return out;
}

/**
 * Partition a deployed flow into user nodes and mock nodes.
 * @param {object[]} deployed
 * @param {Set<string>} existingMockIds  fallback classification for configs
 *                                        that nothing references
 * @returns {{userNodes: object[], mockNodes: object[]}}
 */
function classify(deployed, existingMockIds) {
    const byId = new Map(deployed.map(n => [n.id, n]));
    const tabIds = new Set(
        deployed.filter(n => n.type === 'tab').map(n => n.id)
    );
    const isFlowNode = n => n.z && tabIds.has(n.z);
    const isConfig = n => n.type !== 'tab' && !n.z;
    const configIds = new Set(deployed.filter(isConfig).map(n => n.id));

    // Transitive closure of config nodes reachable from a set of seed nodes
    // (through config -> config references such as ui-group -> ui-page).
    const closure = seeds => {
        const seen = new Set();
        const stack = [];
        for (const n of seeds)
            for (const c of refsOf(n, configIds)) stack.push(c);
        while (stack.length) {
            const c = stack.pop();
            if (seen.has(c)) continue;
            seen.add(c);
            const cn = byId.get(c);
            if (cn) for (const c2 of refsOf(cn, configIds)) stack.push(c2);
        }
        return seen;
    };

    const userFlow = deployed.filter(n => isFlowNode(n) && n.z !== MOCK_TAB);
    const mockFlow = deployed.filter(n => isFlowNode(n) && n.z === MOCK_TAB);
    const userConfigs = closure(userFlow);
    const mockConfigs = closure(mockFlow);

    const mockSet = new Set([MOCK_TAB]);
    for (const n of mockFlow) mockSet.add(n.id);
    // A config owned by mocks only if nothing in the user flow needs it.
    for (const c of mockConfigs) if (!userConfigs.has(c)) mockSet.add(c);
    // Configs nothing references (e.g. global-config) fall back to their
    // previous home; default to the user flow.
    for (const n of deployed) {
        if (
            isConfig(n) &&
            !userConfigs.has(n.id) &&
            !mockConfigs.has(n.id) &&
            existingMockIds.has(n.id)
        ) {
            mockSet.add(n.id);
        }
    }

    return {
        userNodes: deployed.filter(n => !mockSet.has(n.id)),
        mockNodes: deployed.filter(n => mockSet.has(n.id)),
    };
}

/**
 * Re-order nodes to match an existing file so a small edit shows as a small
 * diff. Unknown nodes are appended in their incoming order.
 * @param {object[]} nodes
 * @param {string} existingPath
 * @returns {object[]}
 */
function preserveOrder(nodes, existingPath) {
    if (!fs.existsSync(existingPath)) return nodes;
    const prev = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
    const rank = new Map(prev.map((n, i) => [n.id, i]));
    return nodes
        .map((n, i) => ({ n, i }))
        .sort((a, b) => {
            const ra = rank.has(a.n.id) ? rank.get(a.n.id) : Infinity;
            const rb = rank.has(b.n.id) ? rank.get(b.n.id) : Infinity;
            return ra - rb || a.i - b.i;
        })
        .map(x => x.n);
}

/**
 * @returns {Promise<object[]>}
 */
async function loadDeployed() {
    if (process.env.FLOW_FILE) {
        return JSON.parse(fs.readFileSync(process.env.FLOW_FILE, 'utf8'));
    }
    const res = await fetch(`${NR_URL}/flows`, {
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`GET ${NR_URL}/flows -> ${res.status}`);
    const body = await res.json();
    // The admin API returns a bare array or {rev, flows} depending on the
    // requested Node-RED-API-Version. Handle both.
    const flows = Array.isArray(body) ? body : body.flows;
    if (!Array.isArray(flows)) throw new Error('unexpected /flows shape');
    return flows;
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    const target = (process.argv[2] || 'both').toLowerCase();
    if (!['both', 'user', 'mocks'].includes(target)) {
        console.error(`usage: node pull-flows.js [both|user|mocks]`);
        process.exit(2);
    }

    const existingMockIds = fs.existsSync(MOCKS_PATH)
        ? new Set(
              JSON.parse(fs.readFileSync(MOCKS_PATH, 'utf8')).map(n => n.id)
          )
        : new Set();

    const deployed = await loadDeployed();
    const { userNodes, mockNodes } = classify(deployed, existingMockIds);

    if (target === 'both' || target === 'user') {
        const ordered = preserveOrder(userNodes, USER_PATH);
        fs.writeFileSync(USER_PATH, JSON.stringify(ordered, null, 4) + '\n');
        console.log(
            `[pull-flows] wrote ${USER_PATH} (${ordered.length} user nodes)`
        );
    }
    if (target === 'both' || target === 'mocks') {
        const ordered = preserveOrder(mockNodes, MOCKS_PATH);
        fs.writeFileSync(MOCKS_PATH, JSON.stringify(ordered, null, 4) + '\n');
        console.log(
            `[pull-flows] wrote ${MOCKS_PATH} (${ordered.length} mock nodes)`
        );
    }
    console.log('[pull-flows] review with `git diff` before committing.');
}

main().catch(err => {
    console.error('[pull-flows]', err.message);
    process.exit(1);
});
