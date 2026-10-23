'use strict';

const Gree = require('gree-hvac-client');
const { ConnectionManager } = require('./lib/connection-manager');
const { validateProperties } = require('./lib/validation');
const { ACTIONS, getAction } = require('./lib/actions');

module.exports = function (RED) {
    const num = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    const pad = n => String(n).padStart(2, '0');

    const fmtTime = ts => {
        const d = new Date(ts);
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

        // Unit-specific options of the client (see gree-hvac-config)
        const clientOptions = {
            halfDegree: device.halfDegree === true,
            encodedTargetHumidity: device.encodedTargetHumidity === true,
            statusBatchSize: Math.floor(num(device.statusBatchSize, 20)),
            silent: config.silent === true,
        };
        if (device.subUnit) {
            clientOptions.subUnit = device.subUnit;
        }
        if (resolveByMac) {
            // The client scans the broadcast address and binds only to this
            // MAC; after a DHCP move the polls go unanswered, and its re-bind
            // finds the unit at the new address.
            clientOptions.mac = device.mac;
        }

        const manager = new ConnectionManager({
            ClientCtor: Gree.Client,
            host: resolveByMac ? device.broadcastAddress : device.host,
            port: num(device.port, 7000),
            pollingIntervalMs,
            pollingTimeoutMs,
            connectTimeoutMs,
            recoveryDelayMs,
            maxBackoffMs,
            commandRateMs,
            noResponseThreshold,
            maxQueueSize,
            logLevel: config.logLevel || 'error',
            clientOptions,
        });

        const ctx = node.context();
        let deviceInfo = null;
        let warnedFirmware = false;
        const writeMetrics = () => {
            try {
                ctx.set('gree', { ...manager.metrics(), deviceInfo });
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
            node.send([null, null, { topic: 'diagnostic', payload }, null]);
        };

        // Once per connection: model, firmware id and, for firmwares whose
        // later builds dropped local control, a warning not to upgrade.
        const fetchDeviceInfo = () => {
            manager
                .call('getDeviceInfo')
                .then(info => {
                    deviceInfo = info;
                    writeMetrics();
                    emitDiagnostic({
                        event: 'device_info',
                        at: Date.now(),
                        ...info,
                    });
                    if (info && info.upgradeWarning && !warnedFirmware) {
                        warnedFirmware = true;
                        node.warn(info.upgradeWarning);
                    }
                })
                .catch(error => {
                    if (config.debug) {
                        node.log(
                            'Device info unavailable: ' +
                                ((error && error.message) || error)
                        );
                    }
                });
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
                    if (meta && meta.bound) {
                        fetchDeviceInfo();
                    }
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
                            text:
                                'reconnecting' +
                                (meta && meta.attempt
                                    ? ' (attempt ' + meta.attempt + ')'
                                    : '...'),
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

        // msg.action: a request to the client instead of a property write;
        // its answer goes to output 4, failures to done(err) / catch nodes.
        const runAction = (msg, send, done) => {
            const fail = err => {
                if (done) done(err);
                else node.error(err, msg);
            };
            const action = getAction(msg.action);
            if (!action) {
                fail(
                    new Error(
                        'Unknown action "' +
                            msg.action +
                            '", expected one of ' +
                            Object.keys(ACTIONS).join(', ')
                    )
                );
                return;
            }
            let args;
            try {
                args = action.args(msg);
            } catch (error) {
                fail(error);
                return;
            }
            manager
                .call(msg.action, ...args)
                .then(result => {
                    const out = Object.assign({}, msg, {
                        topic: msg.action,
                        payload: action.reply ? action.reply(args) : result,
                    });
                    (send || node.send.bind(node))([null, null, null, out]);
                    if (done) done();
                })
                .catch(error => {
                    fail(
                        error && error.message === 'offline'
                            ? new Error(msg.action + ' rejected: offline')
                            : error
                    );
                });
        };

        this.on('input', (msg, send, done) => {
            if (msg && typeof msg.action === 'string' && msg.action) {
                runAction(msg, send, done);
                return;
            }
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

        node.status({ fill: 'yellow', shape: 'dot', text: 'connecting...' });
        writeMetrics();
        manager.start();

        this.on('close', done => {
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
            manager
                .stop()
                .catch(() => {})
                .finally(() => done && done());
        });
    }

    RED.nodes.registerType('gree-hvac', GreeHvacNode);
};
