'use strict';

const Gree = require('gree-hvac-client');

module.exports = function (RED) {
    const num = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    /**
     * Wraps gree-hvac-client with a production-grade connection manager.
     *
     * The upstream client retries connect/bind on a fixed schedule using the
     * same UDP socket, never backs off, and never tears the socket down on
     * failure. That is what wedges the Gree WiFi module (it ends up answering
     * stale bind packets with stale keys and stops responding to anything
     * until it is power-cycled). This manager:
     *
     *   - disables the library's auto-connect and owns the lifecycle itself,
     *   - on any connect timeout / fatal error fully disposes the client and
     *     rebuilds a fresh one with an exponential backoff,
     *   - watches the stream of poll responses and forces a hard reset when
     *     the device has been silent for too long,
     *   - throttles and coalesces outbound writes so a noisy flow cannot
     *     flood the WiFi module,
     *   - attaches its own error handler to the underlying dgram socket so a
     *     transient OS error cannot crash Node-RED.
     */
    class ConnectionManager {
        constructor(opts) {
            this.opts = opts;
            this.client = null;
            this.connected = false;
            this.stopped = false;
            this.lastContactAt = 0;
            this.noResponseStreak = 0;
            this.backoffMs = opts.recoveryDelayMs;
            this.reconnectTimer = null;
            this.watchdogTimer = null;
            this.queue = new Map();
            this.lastSendAt = 0;
            this.sendTimer = null;
            this.listeners = { event: [], log: [] };
        }

        on(event, fn) {
            this.listeners[event].push(fn);
        }

        _emit(event, ...args) {
            for (const fn of this.listeners[event]) {
                try {
                    fn(...args);
                } catch (_) {
                    // listener errors must not break the manager
                }
            }
        }

        _log(level, message, meta) {
            this._emit('log', level, message, meta);
        }

        start() {
            this._buildClient();
            this._startWatchdog();
        }

        async stop() {
            this.stopped = true;
            this._clearTimer('reconnectTimer');
            this._clearTimer('watchdogTimer');
            this._clearTimer('sendTimer');
            this.queue.clear();
            await this._teardownClient();
        }

        send(properties) {
            if (!properties || typeof properties !== 'object') {
                return;
            }
            for (const [key, value] of Object.entries(properties)) {
                // last write wins per property — collapses bursts
                this.queue.set(key, value);
            }
            this._scheduleDrain();
        }

        _scheduleDrain() {
            if (this.stopped || this.sendTimer || this.queue.size === 0) {
                return;
            }
            if (!this.connected || !this.client) {
                // will be retried on connect
                return;
            }
            const sinceLast = Date.now() - this.lastSendAt;
            const wait = Math.max(0, this.opts.commandRateMs - sinceLast);
            this.sendTimer = setTimeout(() => {
                this.sendTimer = null;
                this._drainOnce();
            }, wait);
        }

        _drainOnce() {
            if (this.stopped || !this.connected || !this.client) {
                return;
            }
            if (this.queue.size === 0) {
                return;
            }
            const batch = Object.fromEntries(this.queue);
            this.queue.clear();
            this.lastSendAt = Date.now();
            this.client.setProperties(batch).catch(error => {
                // requeue keys that the caller has not overwritten since,
                // so a transient send failure does not lose the command
                for (const [key, value] of Object.entries(batch)) {
                    if (!this.queue.has(key)) {
                        this.queue.set(key, value);
                    }
                }
                this._onClientError(error);
            });
            if (this.queue.size > 0) {
                this._scheduleDrain();
            }
        }

        _buildClient() {
            if (this.stopped) {
                return;
            }
            this._clearTimer('reconnectTimer');

            this._log('info', 'Connecting', {
                host: this.opts.host,
                attemptBackoffMs: this.backoffMs,
            });
            this._emit('event', 'connecting');

            let client;
            try {
                client = new Gree.Client({
                    host: this.opts.host,
                    port: this.opts.port,
                    pollingInterval: this.opts.pollingIntervalMs,
                    pollingTimeout: this.opts.pollingTimeoutMs,
                    connectTimeout: this.opts.connectTimeoutMs,
                    autoConnect: false,
                    logLevel: this.opts.logLevel,
                });
            } catch (error) {
                this._scheduleReconnect(error);
                return;
            }

            this.client = client;
            this.connected = false;
            this.noResponseStreak = 0;

            client.on('connect', () => {
                if (this.client !== client) {
                    return;
                }
                this.connected = true;
                this.lastContactAt = Date.now();
                this.noResponseStreak = 0;
                this.backoffMs = this.opts.recoveryDelayMs; // reset on success
                this._installSocketErrorHandler(client);
                this._emit('event', 'connected', client.getDeviceId());
                this._scheduleDrain();
            });

            client.on('update', (updated, properties) => {
                if (this.client !== client) {
                    return;
                }
                this.lastContactAt = Date.now();
                this.noResponseStreak = 0;
                this._emit('event', 'update', updated, properties);
            });

            client.on('success', (updated, properties) => {
                if (this.client !== client) {
                    return;
                }
                this.lastContactAt = Date.now();
                this.noResponseStreak = 0;
                this._emit('event', 'success', updated, properties);
            });

            client.on('no_response', () => {
                if (this.client !== client) {
                    return;
                }
                this.noResponseStreak += 1;
                this._log('warn', 'No response from device', {
                    streak: this.noResponseStreak,
                    threshold: this.opts.noResponseThreshold,
                });
                this._emit('event', 'no_response', this.noResponseStreak);
                if (this.noResponseStreak >= this.opts.noResponseThreshold) {
                    this._log(
                        'warn',
                        'No-response threshold hit, forcing reset'
                    );
                    this._forceReset();
                }
            });

            client.on('disconnect', () => {
                if (this.client !== client) {
                    return;
                }
                if (!this.connected) {
                    // disconnect during initial connect = cancelled / failed
                    return;
                }
                this.connected = false;
                this._emit('event', 'disconnected');
            });

            client.on('error', error => {
                if (this.client !== client) {
                    return;
                }
                this._onClientError(error);
            });

            client.connect().catch(error => {
                if (this.client !== client) {
                    return;
                }
                this._onClientError(error);
            });

            // The upstream client creates its dgram socket inside connect();
            // attach our own error handler as soon as it exists so a kernel
            // socket error cannot become an uncaught exception.
            this._installSocketErrorHandler(client);
        }

        _installSocketErrorHandler(client) {
            const socket = client._socket;
            if (!socket || socket.__greeHandlerInstalled) {
                return;
            }
            socket.__greeHandlerInstalled = true;
            socket.on('error', error => {
                this._log('warn', 'UDP socket error', { error: error.message });
                if (this.client === client) {
                    this._onClientError(error);
                }
            });
        }

        _onClientError(error) {
            this._emit('event', 'error', error);
            this._forceReset(error);
        }

        _forceReset(cause) {
            if (this.stopped) {
                return;
            }
            const wasConnected = this.connected;
            this.connected = false;
            this._teardownClient()
                .catch(() => {})
                .finally(() => {
                    if (this.stopped) {
                        return;
                    }
                    if (!wasConnected) {
                        // failed to (re)connect — grow backoff
                        this.backoffMs = Math.min(
                            this.opts.maxBackoffMs,
                            Math.max(
                                this.opts.recoveryDelayMs,
                                this.backoffMs * 2
                            )
                        );
                    }
                    this._scheduleReconnect(cause);
                });
        }

        _scheduleReconnect(cause) {
            if (this.stopped || this.reconnectTimer) {
                return;
            }
            const delay = this.backoffMs;
            this._log('info', 'Scheduling reconnect', {
                delayMs: delay,
                reason: cause && cause.message,
            });
            this._emit('event', 'reconnect_scheduled', delay);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this._buildClient();
            }, delay);
            if (typeof this.reconnectTimer.unref === 'function') {
                this.reconnectTimer.unref();
            }
        }

        _startWatchdog() {
            const tick = () => {
                if (this.stopped) {
                    return;
                }
                if (this.connected && this.lastContactAt > 0) {
                    const silent = Date.now() - this.lastContactAt;
                    if (silent > this.opts.unresponsiveTimeoutMs) {
                        this._log('warn', 'Watchdog: device silent too long', {
                            silentMs: silent,
                        });
                        this._forceReset(
                            new Error(
                                'Watchdog: device silent for ' + silent + 'ms'
                            )
                        );
                        return;
                    }
                }
                this.watchdogTimer = setTimeout(tick, this.opts.watchdogTickMs);
                if (typeof this.watchdogTimer.unref === 'function') {
                    this.watchdogTimer.unref();
                }
            };
            this.watchdogTimer = setTimeout(tick, this.opts.watchdogTickMs);
            if (typeof this.watchdogTimer.unref === 'function') {
                this.watchdogTimer.unref();
            }
        }

        _clearTimer(name) {
            if (this[name]) {
                clearTimeout(this[name]);
                this[name] = null;
            }
        }

        async _teardownClient() {
            const client = this.client;
            this.client = null;
            this.connected = false;
            if (!client) {
                return;
            }
            // The upstream client leaves _bindTimeoutRef armed after dispose;
            // we clear it explicitly to stop stale bind packets being fired
            // at the device after we have moved on.
            try {
                if (client._bindTimeoutRef) {
                    clearTimeout(client._bindTimeoutRef);
                    client._bindTimeoutRef = null;
                }
            } catch (_) {
                /* private field — best effort */
            }
            // Neutralise the upstream library's internal reconnect chain.
            // _scheduleReconnect / _initialize keep re-arming setTimeouts
            // even after disconnect, and if their callbacks fire on a
            // closed socket they emit further 'error' events; replacing
            // them with no-ops breaks that chain. We deliberately keep
            // our event listeners (especially 'error') attached so any
            // late event from this client is absorbed instead of becoming
            // an uncaught 'error' emit.
            try {
                client._initialize = () => Promise.resolve();
                client._scheduleReconnect = () => Promise.resolve();
            } catch (_) {
                /* best effort — private fields */
            }
            try {
                await client.disconnect();
            } catch (_) {
                // disconnect throws ClientNotConnectedError when socket is
                // already gone — that is fine, we are tearing down anyway
            }
        }
    }

    /**
     * @param config
     */
    function GreeHvacNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const device = RED.nodes.getNode(config.device);

        if (!device || !device.host) {
            node.status({ fill: 'red', shape: 'ring', text: 'no device' });
            node.error('Gree HVAC device configuration is missing a host');
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
        const commandRateMs = num(config.commandRate, 500);
        const noResponseThreshold = Math.max(
            1,
            Math.floor(num(config.noResponseThreshold, 3))
        );

        const manager = new ConnectionManager({
            host: device.host,
            port: num(device.port, 7000),
            pollingIntervalMs,
            pollingTimeoutMs,
            connectTimeoutMs,
            recoveryDelayMs,
            maxBackoffMs,
            unresponsiveTimeoutMs,
            watchdogTickMs: Math.max(1000, Math.floor(pollingIntervalMs / 2)),
            commandRateMs,
            noResponseThreshold,
            logLevel: config.logLevel || 'error',
        });

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

        const statusConnected = deviceId => {
            node.status({
                fill: 'green',
                shape: 'dot',
                text:
                    'connected' +
                    (deviceId ? ' (' + deviceId + ')' : '') +
                    ' · ' +
                    fmtTime(Date.now()),
            });
        };

        manager.on('event', (type, ...args) => {
            switch (type) {
                case 'connecting':
                    node.status({
                        fill: 'yellow',
                        shape: 'dot',
                        text: 'connecting...',
                    });
                    break;
                case 'connected':
                    statusConnected(args[0]);
                    break;
                case 'update':
                    statusConnected(
                        manager.client && manager.client.getDeviceId()
                    );
                    node.send([
                        { topic: 'updated', payload: args[0] },
                        { topic: 'properties', payload: args[1] },
                    ]);
                    break;
                case 'success':
                    statusConnected(
                        manager.client && manager.client.getDeviceId()
                    );
                    node.send([
                        { topic: 'acknowledged', payload: args[0] },
                        { topic: 'properties', payload: args[1] },
                    ]);
                    break;
                case 'no_response':
                    node.status({
                        fill: 'yellow',
                        shape: 'ring',
                        text:
                            'no response (' +
                            args[0] +
                            '/' +
                            noResponseThreshold +
                            ')',
                    });
                    break;
                case 'reconnect_scheduled':
                    node.status({
                        fill: 'yellow',
                        shape: 'ring',
                        text:
                            'reconnect in ' + Math.round(args[0] / 1000) + 's',
                    });
                    break;
                case 'disconnected':
                    node.status({
                        fill: 'grey',
                        shape: 'ring',
                        text: 'disconnected',
                    });
                    break;
                case 'error':
                    {
                        const err = args[0];
                        const text =
                            (err && err.message) || String(err) || 'error';
                        // Surface the error but keep the node alive — the
                        // manager will reconnect on its own.
                        node.warn(text);
                        node.status({
                            fill: 'red',
                            shape: 'ring',
                            text: text.slice(0, 40),
                        });
                    }
                    break;
                default:
                    break;
            }
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

        this.on('input', (msg, send, done) => {
            try {
                if (
                    msg &&
                    typeof msg.payload === 'object' &&
                    msg.payload !== null
                ) {
                    manager.send(msg.payload);
                } else if (
                    msg &&
                    typeof msg.topic === 'string' &&
                    msg.topic.length > 0
                ) {
                    manager.send({ [msg.topic]: msg.payload });
                } else {
                    node.warn(
                        'Ignored input: expected payload object or msg.topic to be set'
                    );
                }
                if (done) done();
            } catch (error) {
                if (done) done(error);
                else node.error(error, msg);
            }
        });

        this.on('close', done => {
            manager
                .stop()
                .catch(() => {})
                .finally(() => done && done());
        });

        node.status({ fill: 'yellow', shape: 'dot', text: 'connecting...' });
        manager.start();
    }

    RED.nodes.registerType('gree-hvac', GreeHvacNode);
};
