'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { validateProperties } = require('../gree-hvac/lib/validation');
const { getAction } = require('../gree-hvac/lib/actions');

const EXAMPLES = path.join(__dirname, '..', 'examples');
const OWN_TYPES = new Set([
    'gree-hvac',
    'gree-hvac-config',
    'gree-hvac-discover',
]);
// Shipped examples must import on a bare Node-RED: core nodes + ours only,
// except where an example is about an extra package and says so up front.
const CORE_TYPES = new Set([
    'comment',
    'inject',
    'debug',
    'function',
    'change',
    'switch',
]);
const EXTRA_PACKAGES = {
    'dashboard-thermostat.json': {
        name: '@flowfuse/node-red-dashboard',
        // Dashboard 2.0 node types are all ui-*
        types: type => /^ui-[a-z-]+$/.test(type),
    },
};

/**
 * Keys of a node's editor `defaults` block, read from its .html file.
 *
 * @param {string} type
 * @returns {string[]}
 */
function editorDefaults(type) {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'gree-hvac', `${type}.html`),
        'utf8'
    );
    const block = html.match(/defaults: \{\n([\s\S]*?)\n {8}\}/)[1];
    const keys = [...block.matchAll(/^ {12}(\w+):/gm)].map(m => m[1]);
    assert.ok(keys.length > 0, `${type}.html: no defaults parsed`);
    return keys;
}

const files = fs.readdirSync(EXAMPLES).filter(f => f.endsWith('.json'));

test('examples/ ships at least one flow', () => {
    assert.ok(files.length > 0);
});

for (const file of files) {
    const flow = JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8'));
    const byId = new Map(flow.map(n => [n.id, n]));

    const extra = EXTRA_PACKAGES[file];

    test(`${file}: unique ids, known node types, wires resolve`, () => {
        assert.equal(byId.size, flow.length, 'duplicate node ids');
        for (const node of flow) {
            assert.ok(
                OWN_TYPES.has(node.type) ||
                    CORE_TYPES.has(node.type) ||
                    (extra && extra.types(node.type)),
                `${node.id}: node type "${node.type}" needs an extra package`
            );
            for (const target of (node.wires || []).flat()) {
                assert.ok(
                    byId.has(target),
                    `${node.id}: wire to missing node ${target}`
                );
            }
        }
    });

    test(`${file}: gree nodes match their editor definitions`, () => {
        for (const node of flow.filter(n => n.type === 'gree-hvac')) {
            assert.equal(
                byId.get(node.device)?.type,
                'gree-hvac-config',
                `${node.id}: device`
            );
            assert.equal(
                node.wires.length,
                4,
                `${node.id}: gree-hvac has 4 outputs`
            );
        }
        for (const node of flow.filter(n => OWN_TYPES.has(n.type))) {
            for (const key of editorDefaults(node.type)) {
                assert.ok(key in node, `${node.id}: missing "${key}"`);
            }
        }
    });

    test(`${file}: inject payloads / actions into gree-hvac pass validation`, () => {
        const greeIds = new Set(
            flow.filter(n => n.type === 'gree-hvac').map(n => n.id)
        );
        const injects = flow.filter(
            n =>
                n.type === 'inject' &&
                n.wires.flat().some(id => greeIds.has(id))
        );
        for (const node of injects) {
            const action = (node.props || []).find(p => p.p === 'action');
            if (action) {
                // a request instead of a property write: a known action
                // whose arguments are accepted
                assert.ok(
                    getAction(action.v),
                    `${node.id}: action ${action.v}`
                );
                const payload =
                    node.payloadType === 'json'
                        ? JSON.parse(node.payload)
                        : node.payloadType === 'date'
                          ? Date.now()
                          : node.payload;
                assert.doesNotThrow(
                    () => getAction(action.v).args({ payload }),
                    `${node.id} (${node.name})`
                );
                continue;
            }
            const value =
                node.payloadType === 'json'
                    ? JSON.parse(node.payload)
                    : node.payload;
            const props = node.topic ? { [node.topic]: value } : value;
            const { warnings } = validateProperties(props);
            assert.deepEqual(warnings, [], `${node.id} (${node.name})`);
        }
    });

    if (extra) {
        test(`${file}: says up front which package it needs`, () => {
            const comments = flow.filter(n => n.type === 'comment');
            assert.ok(
                comments.some(c => c.name.includes(extra.name)),
                `a comment node naming ${extra.name}`
            );
        });
    }

    test(`${file}: dashboard widgets wired into gree-hvac send valid properties`, () => {
        const greeIds = new Set(
            flow.filter(n => n.type === 'gree-hvac').map(n => n.id)
        );
        const widgets = flow.filter(
            n =>
                /^ui-/.test(n.type) &&
                (n.wires || []).flat().some(id => greeIds.has(id))
        );
        for (const node of widgets) {
            assert.equal(node.topicType, 'str', `${node.id}: fixed topic`);
            // a device update must not echo back as a command
            assert.equal(node.passthru, false, `${node.id}: passthru off`);
            const values = [
                node.onvalue,
                node.offvalue,
                ...(node.options || []).map(o => o.value),
            ].filter(v => v !== undefined);
            if (node.type === 'ui-slider') {
                values.push(node.min, node.max);
            }
            assert.ok(values.length > 0, `${node.id}: no values to check`);
            for (const value of values) {
                const { warnings } = validateProperties({
                    [node.topic]: value,
                });
                assert.deepEqual(
                    warnings,
                    [],
                    `${node.id} (${node.name}): ${node.topic}=${value}`
                );
            }
        }
    });
}
