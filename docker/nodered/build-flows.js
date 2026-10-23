'use strict';

// Build step for the dev image: turns the shipped example flows into the
// stack's /data/flows.json. Each example gets its own tab; config nodes (no
// x/y) stay global, and every gree-hvac-config points at the simulator
// ("gree.lan" on the compose network). Node ids are kept, so the e2e suite
// can fire the inject nodes by id.
//
//   node build-flows.js <out/flows.json> <example.json>...

const fs = require('fs');
const path = require('path');

const [out, ...examples] = process.argv.slice(2);
if (!out || examples.length === 0) {
    console.error('usage: node build-flows.js <flows.json> <example.json>...');
    process.exit(2);
}

// The first tab keeps the id the e2e suite looks for.
const TAB_IDS = { 'basic-control': 'gree-dev-tab' };
const LABELS = {
    'basic-control': 'Gree dev (simulator)',
    'dashboard-thermostat': 'Gree dashboard (simulator)',
};

const flows = [];
for (const src of examples) {
    const name = path.basename(src, '.json');
    const tab = TAB_IDS[name] || `gree-${name}-tab`;
    flows.push({
        id: tab,
        type: 'tab',
        label: LABELS[name] || name,
        disabled: false,
    });
    for (const node of JSON.parse(fs.readFileSync(src, 'utf8'))) {
        if (node.type === 'gree-hvac-config') {
            flows.push({ ...node, host: 'gree.lan' });
        } else if (node.x === undefined) {
            flows.push(node); // config node: global
        } else {
            flows.push({ ...node, z: tab });
        }
    }
    console.log(`[build-flows] ${src} -> tab ${tab}`);
}

fs.writeFileSync(out, JSON.stringify(flows, null, 2) + '\n');
console.log(`[build-flows] wrote ${out} (${flows.length} nodes)`);
