'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { validateProperties } = require('../gree-hvac/lib/validation');

const EXAMPLES = path.join(__dirname, '..', 'examples');
const OWN_TYPES = new Set([
    'gree-hvac',
    'gree-hvac-config',
    'gree-hvac-discover',
]);
// Shipped examples must import on a bare Node-RED: core nodes + ours only.
const CORE_TYPES = new Set([
    'comment',
    'inject',
    'debug',
    'function',
    'change',
    'switch',
]);

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

    test(`${file}: unique ids, known node types, wires resolve`, () => {
        assert.equal(byId.size, flow.length, 'duplicate node ids');
        for (const node of flow) {
            assert.ok(
                OWN_TYPES.has(node.type) || CORE_TYPES.has(node.type),
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
                3,
                `${node.id}: gree-hvac has 3 outputs`
            );
        }
        for (const node of flow.filter(n => OWN_TYPES.has(n.type))) {
            for (const key of editorDefaults(node.type)) {
                assert.ok(key in node, `${node.id}: missing "${key}"`);
            }
        }
    });

    test(`${file}: inject payloads into gree-hvac pass validation`, () => {
        const greeIds = new Set(
            flow.filter(n => n.type === 'gree-hvac').map(n => n.id)
        );
        const injects = flow.filter(
            n =>
                n.type === 'inject' &&
                n.wires.flat().some(id => greeIds.has(id))
        );
        for (const node of injects) {
            const value =
                node.payloadType === 'json'
                    ? JSON.parse(node.payload)
                    : node.payload;
            const props = node.topic ? { [node.topic]: value } : value;
            const { warnings } = validateProperties(props);
            assert.deepEqual(warnings, [], `${node.id} (${node.name})`);
        }
    });
}
