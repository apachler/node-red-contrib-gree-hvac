'use strict';

const Gree = require('gree-hvac-client');
const { ConnectionManager } = require('./lib/connection-manager');
const { MacResolver } = require('./lib/mac-resolver');
const { validateProperties } = require('./lib/validation');

module.exports = function (RED) {
    const num = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    const fmtTime = ts => {
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return (
            pad(d.getHours()) +
            ':' +
            pad(d.getMinutes()) +
            ':' +
            pad(d.getSeconds())
        );
    };

    /**
     * @param config
     */
    function GreeHvacNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const device = RED.nodes.getNode(config.device);

        const resolveByMac = !!(device && device.resolveByMac && device.mac);

        if (!device || (!device.host && !resolveByMac)) {
            node.status({ fill: 'red', shape: 'ring', text: 'no device' });
            node.error(
                'Gree HVAC device configuration is missing a host (or a MAC to resolve)'
            );
            return;
        }

        const pollingIntervalMs = num(config.interval, 4) * 1000;
        const pollingTimeoutMs =
            num(
                config.pollingTimeout,
                Math.max(4, Math.ceil(pollingIntervalMs / 1000) * 2)
            ) * 1000;
        const connectTimeoutMs = num(config.connectTimeout, 8) * 1000;
        const recoveryDelayMs = num(config.recoveryDelay, 30) * 1000;
        const maxBackoffMs = num(config.maxBackoff, 300) * 1000;
        const unresponsiveTimeoutMs =
            num(
                config.unresponsiveTimeout,
                Math.max(30, Math.ceil((pollingIntervalMs * 5) / 1000))
            ) * 1000;
        const connectingTimeoutMs = Math.max(
            connectTimeoutMs * 4,
            num(config.connectingTimeout, 60) * 1000
        );
        const commandRateMs = num(config.commandRate, 500);
        const noResponseThreshold = Math.max(
            1,
            Math.floor(num(config.noResponseThreshold, 3))
        );
        const maxQueueSize = Math.max(
            1,
            Math.floor(num(config.maxQueueSize, 64))
        );
        const heartbeatIntervalMs = Math.max(
            0,
            Math.floor(num(config.heartbeatInterval, 60)) * 1000
        );
        const rejectIfOffline = config.rejectIfOffline === true;
        const validate = config.validate !== false; // default on

        const manager = new ConnectionManager({
            ClientCtor: Gree.Client,
            host: device.host || null,
            port: num(device.port, 7000),
            pollingIntervalMs,
            pollingTimeoutMs,
            connectTimeoutMs,
            recoveryDelayMs,
            maxBackoffMs,
            unresponsiveTimeoutMs,
            connectingTimeoutMs,
            watchdogTickMs: Math.max(1000, Math.floor(pollingIntervalMs / 2)),
            commandRateMs,
            noResponseThreshold,
            maxQueueSize,
            logLevel: config.logLevel || 'error',
        });

        const ctx = node.context();
        const writeMetrics = () => {
            try {
                ctx.set('gree', manager.metrics());
            } catch (_) {
                /* context backend optional */
            }
        };

        const statusConnected = () => {
            const id = manager.deviceId;
            node.status({
                fill: 'green',
                shape: 'dot',
                text:
                    'connected' +
                    (id ? ' (' + id + ')' : '') +
                    ' · ' +
                    fmtTime(Date.now()),
            });
        };

        const emitDiagnostic = payload => {
            // 3rd output — structured event for alerting / dashboards
            node.send([null, null, { topic: 'diagnostic', payload }]);
        };

        manager.on('state', (state, prev, meta) => {
            writeMetrics();
            switch (state) {
                case 'connecting':
                    node.status({
                        fill: 'yellow',
                        shape: 'dot',
                        text: 'connecting...',
                    });
                    break;
                case 'connected':
                    statusConnected();
                    break;
                case 'no_response':
                    node.status({
                        fill: 'yellow',
                        shape: 'ring',
                        text:
                            'no response (' +
                            (meta && meta.streak) +
                            '/' +
                            noResponseThreshold +
                            ')',
                    });
                    break;
                case 'reconnecting':
                    if (meta && meta.delayMs) {
                        node.status({
                            fill: 'yellow',
                            shape: 'ring',
                            text:
                                'reconnect in ' +
                                Math.round(meta.delayMs / 1000) +
                                's',
                        });
                    } else {
                        node.status({
                            fill: 'grey',
                            shape: 'ring',
                            text: 'reconnecting...',
                        });
                    }
                    break;
                case 'stopped':
                    node.status({
                        fill: 'grey',
                        shape: 'ring',
                        text: 'stopped',
                    });
                    break;
                default:
                    break;
            }
        });

        manager.on('update', (updated, properties) => {
            statusConnected();
            writeMetrics();
            node.send([
                { topic: 'updated', payload: updated },
                { topic: 'properties', payload: properties },
                null,
            ]);
        });

        manager.on('success', (updated, properties) => {
            statusConnected();
            writeMetrics();
            node.send([
                { topic: 'acknowledged', payload: updated },
                { topic: 'properties', payload: properties },
                null,
            ]);
        });

        manager.on('write_failed', (error, batch) => {
            // Surface for catch-nodes if we still have the original input msg
            // (we don't — write_failed fires from the drain queue), so report
            // generically. Individual rejections from the input handler are
            // routed via node.error(err, msg) where the msg is available.
            node.warn(
                'Write failed: ' +
                    ((error && error.message) || error) +
                    ' batch=' +
                    JSON.stringify(batch)
            );
        });

        manager.on('failure', error => {
            const text = (error && error.message) || String(error) || 'error';
            node.status({
                fill: 'red',
                shape: 'ring',
                text: text.slice(0, 40),
            });
        });

        manager.on('diagnostic', payload => {
            emitDiagnostic(payload);
            writeMetrics();
        });

        manager.on('log', (level, message, meta) => {
            if (config.debug || level === 'error') {
                const payload = meta
                    ? message + ' ' + JSON.stringify(meta)
                    : message;
                if (level === 'error') {
                    node.error(payload);
                } else if (level === 'warn') {
                    node.warn(payload);
                } else {
                    node.log(payload);
                }
            }
        });

        let heartbeatTimer = null;
        if (heartbeatIntervalMs > 0) {
            heartbeatTimer = setInterval(() => {
                emitDiagnostic({ event: 'heartbeat', ...manager.metrics() });
            }, heartbeatIntervalMs);
            if (typeof heartbeatTimer.unref === 'function') {
                heartbeatTimer.unref();
            }
        }

        this.on('input', (msg, send, done) => {
            try {
                let raw;
                if (
                    msg &&
                    typeof msg.payload === 'object' &&
                    msg.payload !== null
                ) {
                    raw = msg.payload;
                } else if (
                    msg &&
                    typeof msg.topic === 'string' &&
                    msg.topic.length > 0
                ) {
                    raw = { [msg.topic]: msg.payload };
                } else {
                    const err = new Error(
                        'Invalid input: expected payload object or msg.topic'
                    );
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }

                let properties = raw;
                if (validate) {
                    const result = validateProperties(raw);
                    properties = result.properties;
                    for (const w of result.warnings) {
                        node.warn(w);
                    }
                    if (Object.keys(properties).length === 0) {
                        const err = new Error(
                            'No valid properties to send: ' +
                                result.warnings.join('; ')
                        );
                        if (done) done(err);
                        else node.error(err, msg);
                        return;
                    }
                }

                const res = manager.send(properties, { rejectIfOffline });
                if (!res.accepted) {
                    const err = new Error(
                        'Command rejected: ' + (res.reason || 'unknown')
                    );
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                if (done) done();
            } catch (error) {
                if (done) done(error);
                else node.error(error, msg);
            }
        });

        // Optional resolve-by-MAC: follow the device across DHCP IP changes by
        // periodically discovering it and re-pointing the manager when its IP
        // moves. When no initial host is configured we defer the first connect
        // until the MAC first resolves to an address.
        let resolver = null;
        let started = false;
        const startManager = () => {
            if (started) {
                return;
            }
            started = true;
            manager.start();
        };

        if (resolveByMac) {
            resolver = new MacResolver({
                mac: device.mac,
                port: num(device.port, 7000),
                broadcastAddress: device.broadcastAddress,
                intervalMs:
                    Math.max(5, num(device.rediscoverInterval, 60)) * 1000,
                initialAddress: device.host || null,
            });
            resolver.on('resolved', (addr, from) => {
                node.log(
                    'Resolved ' +
                        device.mac +
                        ' -> ' +
                        addr +
                        (from ? ' (was ' + from + ')' : '')
                );
                if (!started) {
                    manager.opts.host = addr;
                    startManager();
                } else {
                    manager.setHost(addr);
                }
            });
            resolver.on('log', (level, message, meta) => {
                if (config.debug || level === 'error') {
                    const payload = meta
                        ? message + ' ' + JSON.stringify(meta)
                        : message;
                    if (level === 'warn') {
                        node.warn(payload);
                    } else {
                        node.log(payload);
                    }
                }
            });
            resolver.start();
        }

        node.status({ fill: 'yellow', shape: 'dot', text: 'connecting...' });
        writeMetrics();

        // Start now if we have an address; otherwise wait for the resolver.
        if (device.host || !resolveByMac) {
            startManager();
        }

        this.on('close', done => {
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
            if (resolver) {
                resolver.stop();
                resolver = null;
            }
            manager
                .stop()
                .catch(() => {})
                .finally(() => done && done());
        });
    }

    RED.nodes.registerType('gree-hvac', GreeHvacNode);
};
