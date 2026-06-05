'use strict';

/**
 * Build script: produces docker/nodered/flows.json from the verbatim user
 * flow plus a mocks tab. Run at image build time so the user-supplied
 * source file is never mutated.
 *
 *   node merge-flows.js <user-flow> <mocks-flow> <output>
 */

const fs = require('fs');

const [, , userPath, mocksPath, outPath] = process.argv;
if (!userPath || !mocksPath || !outPath) {
    console.error(
        'usage: node merge-flows.js <user-flow.json> <mocks-flow.json> <output.json>'
    );
    process.exit(2);
}

const user = JSON.parse(fs.readFileSync(userPath, 'utf8'));
const mocks = JSON.parse(fs.readFileSync(mocksPath, 'utf8'));

if (!Array.isArray(user) || !Array.isArray(mocks)) {
    console.error('expected JSON arrays in both flow files');
    process.exit(2);
}

// Catch accidental id collisions between mocks and the user flow.
const userIds = new Set(user.map(n => n.id));
const collisions = mocks.map(n => n.id).filter(id => userIds.has(id));
if (collisions.length) {
    console.error('id collision between user flow and mocks:', collisions);
    process.exit(2);
}

fs.writeFileSync(outPath, JSON.stringify(user.concat(mocks), null, 4));
console.log(
    `[merge-flows] wrote ${outPath} (${user.length} user + ${mocks.length} mock nodes)`
);
