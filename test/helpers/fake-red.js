'use strict';

const EventEmitter = require('events');

/**
 * Minimal stand-in for the Node-RED runtime: just enough of RED.nodes and the
 * node API (status/send/error/warn/log/context, input + close events) to
 * construct the contrib nodes in-process and observe what they do. Pulling in
 * the real node-red package for this would add its whole dependency tree.
 *
 * @returns {object} { RED, create, input, close }
 */
function createFakeRed() {
    const types = {};
    const registry = {};

    const RED = {
        nodes: {
            createNode(node, config) {
                for (const name of Object.getOwnPropertyNames(
                    EventEmitter.prototype
                )) {
                    if (name !== 'constructor') {
                        node[name] = EventEmitter.prototype[name];
                    }
                }
                EventEmitter.call(node);
                const store = {};
                Object.assign(node, {
                    id: config.id,
                    name: config.name,
                    statuses: [],
                    sent: [],
                    errors: [],
                    warnings: [],
                    logs: [],
                    status(s) {
                        node.statuses.push(s);
                        node.emit('_status', s);
                    },
                    send(msg) {
                        node.sent.push(msg);
                        node.emit('_send', msg);
                    },
                    error(err) {
                        node.errors.push(err);
                    },
                    warn(w) {
                        node.warnings.push(w);
                    },
                    log(l) {
                        node.logs.push(l);
                    },
                    context() {
                        return {
                            get: k => store[k],
                            set: (k, v) => {
                                store[k] = v;
                            },
                        };
                    },
                });
            },
            registerType(name, ctor) {
                types[name] = ctor;
            },
            getNode(id) {
                return registry[id];
            },
        },
    };

    const create = (type, config) => {
        const node = new types[type](config);
        registry[config.id] = node;
        return node;
    };

    // Resolves with the error passed to done() (undefined on success) and
    // whatever the node handed to send().
    const input = (node, msg) =>
        new Promise(resolve => {
            const sent = [];
            node.emit(
                'input',
                msg,
                m => sent.push(m),
                err => resolve({ err, sent })
            );
        });

    const close = node =>
        new Promise(resolve => {
            node.emit('close', resolve);
        });

    return { RED, create, input, close };
}

/**
 * Wait until predicate() is truthy, polling every 25 ms.
 *
 * @param {Function} predicate
 * @param {number} ms timeout
 * @param {string} what description for the timeout error
 * @returns {Promise<*>} the truthy value
 */
async function waitFor(predicate, ms = 5000, what = 'condition') {
    const deadline = Date.now() + ms;
    for (;;) {
        const v = predicate();
        if (v) return v;
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${what}`);
        }
        await new Promise(r => setTimeout(r, 25));
    }
}

module.exports = { createFakeRed, waitFor };
