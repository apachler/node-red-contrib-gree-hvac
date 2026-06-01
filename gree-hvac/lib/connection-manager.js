'use strict';

const EventEmitter = require('events');

/**
 * Wraps gree-hvac-client with a production-grade connection manager.
 *
 * Responsibilities:
 *   - Owns the client lifecycle (the library's auto-connect is disabled
 *     and we drive connect / disconnect ourselves) so a flaky device
 *     cannot keep flooding the WiFi module with scan/bind packets.
 *   - Exponential backoff with a long initial recovery delay (gives the
 *     WiFi module time to recover from a wedged state).
 *   - Watchdog on the stream of poll responses + a separate watchdog
 *     for "stuck in connecting" so a misconfigured device cannot hang
 *     the node forever.
 *   - Throttled and coalesced outbound writes, with a hard cap on the
 *     pending queue size (oldest-eviction with a warn) so an offline
 *     device cannot cause unbounded memory growth.
 *   - Late-event absorption: stale clients are kept subscribed but
 *     their events are ignored, so we never get an uncaught 'error'.
 *
 * Decoupled from Node-RED so it can be unit-tested.
 *
 * Events:
 *   - 'state'        (newState, prevState, meta)   one of:
 *                    'connecting' | 'connected' | 'reconnecting' |
 *                    'no_response' | 'stopped'
 *   - 'update'       (updated, properties)         delta from device
 *   - 'success'      (updated, properties)         write ack from device
 *   - 'failure'      (error)                       non-fatal error from the
 *                                                  device or client; the
 *                                                  manager will reconnect
 *   - 'diagnostic'   ({ event, ...details })       structured event for
 *                                                  observability outputs
 *   - 'log'          (level, message, meta)
 *   - 'write_failed' (error, propertiesObject)     for catch-node routing
 *
 * Note: deliberately uses `'failure'` rather than `'error'` so callers that
 * don't subscribe never see an uncaught EventEmitter `'error'` throw.
 */
class ConnectionManager extends EventEmitter {
    /**
     * @param {object} opts
     * @param {Function} opts.ClientCtor   `gree-hvac-client`'s Client class (DI for tests)
     * @param {string}  opts.host
     * @param {number}  opts.port
     * @param {number}  opts.pollingIntervalMs
     * @param {number}  opts.pollingTimeoutMs
     * @param {number}  opts.connectTimeoutMs
     * @param {number}  opts.recoveryDelayMs        initial reconnect delay
     * @param {number}  opts.maxBackoffMs           ceiling on exponential backoff
     * @param {number}  opts.unresponsiveTimeoutMs  watchdog: silence while "connected"
     * @param {number}  opts.connectingTimeoutMs    watchdog: stuck-in-connecting cap
     * @param {number}  opts.watchdogTickMs
     * @param {number}  opts.commandRateMs          minimum spacing between writes
     * @param {number}  opts.noResponseThreshold    consecutive missed polls before reset
     * @param {number}  opts.maxQueueSize           hard cap on pending writes
     * @param {string}  opts.logLevel
     */
    constructor(opts) {
        super();
        this.opts = opts;
        this.client = null;
        this.state = 'idle';
        this.connected = false;
        this.stopped = false;
        this.connectedAt = 0;
        this.lastContactAt = 0;
        this.connectingSince = 0;
        this.consecutiveResets = 0;
        this.noResponseStreak = 0;
        this.backoffMs = opts.recoveryDelayMs;
        this.reconnectTimer = null;
        this.watchdogTimer = null;
        this.queue = new Map();
        this.queueOverflows = 0;
        this.lastSendAt = 0;
        this.sendTimer = null;
        this.deviceId = null;
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
        this._setState('stopped');
        await this._teardownClient();
    }

    /**
     * Queue a property write. Returns true if accepted, false if rejected
     * (rejected only when `rejectIfOffline` is true and we're offline).
     * @param {object} properties
     * @param {object} [meta]
     * @param {boolean} [meta.rejectIfOffline]
     * @returns {{accepted: boolean, reason?: string}}
     */
    send(properties, meta) {
        if (!properties || typeof properties !== 'object') {
            return { accepted: false, reason: 'invalid_properties' };
        }
        if (this.stopped) {
            return { accepted: false, reason: 'stopped' };
        }
        if (meta && meta.rejectIfOffline && !this.connected) {
            return { accepted: false, reason: 'offline' };
        }
        for (const [key, value] of Object.entries(properties)) {
            // last write wins per property — collapses bursts
            this.queue.set(key, value);
        }
        this._enforceQueueLimit();
        this._scheduleDrain();
        return { accepted: true };
    }

    isConnected() {
        return this.connected;
    }

    /**
     * Snapshot for diagnostics output / runtime context.
     */
    metrics() {
        const now = Date.now();
        return {
            state: this.state,
            connected: this.connected,
            deviceId: this.deviceId,
            connectedAt: this.connectedAt || null,
            uptimeMs: this.connectedAt ? now - this.connectedAt : 0,
            lastContactAt: this.lastContactAt || null,
            silentMs: this.lastContactAt ? now - this.lastContactAt : null,
            noResponseStreak: this.noResponseStreak,
            consecutiveResets: this.consecutiveResets,
            queueSize: this.queue.size,
            queueOverflows: this.queueOverflows,
            nextReconnectInMs: this.reconnectTimer ? this.backoffMs : null,
            backoffMs: this.backoffMs,
        };
    }

    _setState(state, meta) {
        if (this.state === state) {
            return;
        }
        const prev = this.state;
        this.state = state;
        this.emit('state', state, prev, meta || {});
        this.emit('diagnostic', {
            event: 'state',
            from: prev,
            to: state,
            at: Date.now(),
            ...this.metrics(),
            ...(meta || {}),
        });
    }

    _enforceQueueLimit() {
        if (this.queue.size <= this.opts.maxQueueSize) {
            return;
        }
        // drop the oldest entries until we are back under the cap
        const evicting = this.queue.size - this.opts.maxQueueSize;
        const it = this.queue.keys();
        for (let i = 0; i < evicting; i++) {
            const k = it.next().value;
            this.queue.delete(k);
            this.queueOverflows += 1;
        }
        this.emit('log', 'warn', 'Outbound queue overflow, dropped oldest', {
            evicted: evicting,
            cap: this.opts.maxQueueSize,
        });
        this.emit('diagnostic', {
            event: 'queue_overflow',
            at: Date.now(),
            evicted: evicting,
            cap: this.opts.maxQueueSize,
        });
    }

    _scheduleDrain() {
        if (this.stopped || this.sendTimer || this.queue.size === 0) {
            return;
        }
        if (!this.connected || !this.client) {
            return; // will be retried after connect
        }
        const sinceLast = Date.now() - this.lastSendAt;
        const wait = Math.max(0, this.opts.commandRateMs - sinceLast);
        this.sendTimer = setTimeout(() => {
            this.sendTimer = null;
            this._drainOnce();
        }, wait);
        if (typeof this.sendTimer.unref === 'function') {
            this.sendTimer.unref();
        }
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
            // Surface the write failure to listeners so catch-nodes can
            // see it with the originating payload; then requeue keys the
            // caller has not overwritten since.
            this.emit('write_failed', error, batch);
            for (const [key, value] of Object.entries(batch)) {
                if (!this.queue.has(key)) {
                    this.queue.set(key, value);
                }
            }
            this._enforceQueueLimit();
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

        this.emit('log', 'info', 'Connecting', {
            host: this.opts.host,
            attemptBackoffMs: this.backoffMs,
        });
        this.connectingSince = Date.now();
        this._setState('connecting');

        let client;
        try {
            client = new this.opts.ClientCtor({
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
            if (this.client !== client) return;
            this.connected = true;
            this.connectedAt = Date.now();
            this.lastContactAt = this.connectedAt;
            this.noResponseStreak = 0;
            this.consecutiveResets = 0;
            this.backoffMs = this.opts.recoveryDelayMs; // reset on success
            this.deviceId =
                (typeof client.getDeviceId === 'function' &&
                    client.getDeviceId()) ||
                null;
            this._installSocketErrorHandler(client);
            this._setState('connected', { deviceId: this.deviceId });
            this._scheduleDrain();
        });

        client.on('update', (updated, properties) => {
            if (this.client !== client) return;
            this.lastContactAt = Date.now();
            this.noResponseStreak = 0;
            this.emit('update', updated, properties);
            this.emit('diagnostic', {
                event: 'update',
                at: this.lastContactAt,
                updated,
            });
        });

        client.on('success', (updated, properties) => {
            if (this.client !== client) return;
            this.lastContactAt = Date.now();
            this.noResponseStreak = 0;
            this.emit('success', updated, properties);
            this.emit('diagnostic', {
                event: 'write_ack',
                at: this.lastContactAt,
                updated,
            });
        });

        client.on('no_response', () => {
            if (this.client !== client) return;
            this.noResponseStreak += 1;
            this.emit('log', 'warn', 'No response from device', {
                streak: this.noResponseStreak,
                threshold: this.opts.noResponseThreshold,
            });
            this._setState('no_response', { streak: this.noResponseStreak });
            if (this.noResponseStreak >= this.opts.noResponseThreshold) {
                this.emit(
                    'log',
                    'warn',
                    'No-response threshold hit, forcing reset'
                );
                this._forceReset(
                    new Error(
                        'No response from device for ' +
                            this.noResponseStreak +
                            ' consecutive polls'
                    )
                );
            }
        });

        client.on('disconnect', () => {
            if (this.client !== client) return;
            if (!this.connected) return; // cancelled / failed connect
            this.connected = false;
            this._setState('reconnecting', { reason: 'client_disconnect' });
        });

        client.on('error', error => {
            if (this.client !== client) return;
            this._onClientError(error);
        });

        client.connect().catch(error => {
            if (this.client !== client) return;
            this._onClientError(error);
        });

        // the upstream client creates its dgram socket synchronously inside
        // connect(); attach our handler as soon as it exists
        this._installSocketErrorHandler(client);
    }

    _installSocketErrorHandler(client) {
        const socket = client && client._socket;
        if (!socket || socket.__greeHandlerInstalled) return;
        socket.__greeHandlerInstalled = true;
        socket.on('error', error => {
            this.emit('log', 'warn', 'UDP socket error', {
                error: error.message,
            });
            if (this.client === client) {
                this._onClientError(error);
            }
        });
    }

    _onClientError(error) {
        this.emit('failure', error);
        this.emit('diagnostic', {
            event: 'error',
            at: Date.now(),
            message: error && error.message,
            name: error && error.name,
        });
        this._forceReset(error);
    }

    _forceReset(cause) {
        if (this.stopped) return;
        const wasConnected = this.connected;
        this.connected = false;
        this.consecutiveResets += 1;
        this._teardownClient()
            .catch(() => {})
            .finally(() => {
                if (this.stopped) return;
                if (!wasConnected) {
                    this.backoffMs = Math.min(
                        this.opts.maxBackoffMs,
                        Math.max(this.opts.recoveryDelayMs, this.backoffMs * 2)
                    );
                }
                this._scheduleReconnect(cause);
            });
    }

    _scheduleReconnect(cause) {
        if (this.stopped || this.reconnectTimer) return;
        const delay = this.backoffMs;
        this.emit('log', 'info', 'Scheduling reconnect', {
            delayMs: delay,
            reason: cause && cause.message,
        });
        this._setState('reconnecting', {
            delayMs: delay,
            reason: cause && cause.message,
        });
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
            if (this.stopped) return;
            const now = Date.now();
            if (this.connected && this.lastContactAt > 0) {
                const silent = now - this.lastContactAt;
                if (silent > this.opts.unresponsiveTimeoutMs) {
                    this.emit(
                        'log',
                        'warn',
                        'Watchdog: device silent too long',
                        {
                            silentMs: silent,
                        }
                    );
                    this._forceReset(
                        new Error(
                            'Watchdog: device silent for ' + silent + 'ms'
                        )
                    );
                    return;
                }
            } else if (
                !this.connected &&
                this.connectingSince > 0 &&
                !this.reconnectTimer
            ) {
                const connectingFor = now - this.connectingSince;
                if (connectingFor > this.opts.connectingTimeoutMs) {
                    this.emit(
                        'log',
                        'warn',
                        'Watchdog: stuck connecting, forcing reset',
                        { connectingForMs: connectingFor }
                    );
                    this._forceReset(
                        new Error(
                            'Stuck in connecting for ' + connectingFor + 'ms'
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
        this.connectedAt = 0;
        this.connectingSince = 0;
        if (!client) return;
        // The upstream client leaves _bindTimeoutRef armed after dispose.
        try {
            if (client._bindTimeoutRef) {
                clearTimeout(client._bindTimeoutRef);
                client._bindTimeoutRef = null;
            }
        } catch (_) {
            /* best effort */
        }
        // Neutralise the upstream's internal reconnect chain so its still-
        // pending setTimeouts can't fire on a closed socket and emit
        // further 'error' events. We deliberately keep our listeners
        // attached (especially 'error') so any late event from this client
        // is absorbed instead of becoming an uncaught 'error' emit.
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
            // already gone — fine, we are tearing down anyway
        }
    }
}

module.exports = { ConnectionManager };
