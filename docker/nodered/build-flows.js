'use strict';

// Build step for the dev image: turns the shipped example flow into the
// stack's /data/flows.json. Wraps the example's nodes in one tab and points
// its gree-hvac-config at the simulator ("gree.lan" on the compose network).
// Node ids are kept, so the e2e suite can fire the inject nodes by id.
//
//   node build-flows.js <examples/basic-control.json> <out/flows.json>

const fs = require('fs');

const [src, out] = process.argv.slice(2);
if (!src || !out) {
    console.error('usage: node build-flows.js <example.json> <flows.json>');
    process.exit(2);
}

const TAB = 'gree-dev-tab';
const nodes = JSON.parse(fs.readFileSync(src, 'utf8')).map(node => {
    if (node.type === 'gree-hvac-config') return { ...node, host: 'gree.lan' };
    return { ...node, z: TAB };
});
const flows = [
    { id: TAB, type: 'tab', label: 'Gree dev (simulator)', disabled: false },
    ...nodes,
];

fs.writeFileSync(out, JSON.stringify(flows, null, 2) + '\n');
console.log(`[build-flows] ${src} -> ${out} (${nodes.length} nodes)`);
