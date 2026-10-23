'use strict';

const EventEmitter = require('events');

/**
 * Adapts gree-hvac-client to the needs of a Node-RED node running 24/7.
 *
 * The client (>= 4.4) owns connecting and recovery: connect retries with
 * back-off, the re-bind after `maxNoResponse` missed polls with a
 * `recoveryDelay` pause, a new UDP socket per attempt, and following the
 * unit by MAC when `host` is a broadcast address. This class adds what is
 * Node-RED policy rather than protocol:
 *   - one long-lived client, connected on start() and disconnected on stop()
 *   - a state machine + diagnostics / metrics built from the client events
 *   - a throttled, coalescing write queue that holds writes while offline
 *     (the client sends writes while unbound and loses them), capped with
 *     oldest-eviction so an offline device cannot grow memory without bound
 *   - dropping a property the client refuses instead of failing the batch
 *
 * Decoupled from Node-RED so it can be unit-tested.
 *
 * Events:
 *   - 'state'        (newState, prevState, meta)   one of:
 *                    'connecting' | 'connected' | 'reconnecting' |
 *                    'no_response' | 'stopped'
 *   - 'update'       (updated, properties)         delta from device
 *   - 'success'      (updated, properties)         write ack from device
 *   - 'failure'      (error)                       an error the client
 *                                                  reported; it recovers
 *                                                  by itself
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
     * @param {string}  opts.host                  device IP, or a broadcast address with clientOptions.mac
     * @param {number}  opts.port
     * @param {number}  opts.pollingIntervalMs
     * @param {number}  opts.pollingTimeoutMs
     * @param {number}  opts.connectTimeoutMs
     * @param {number}  opts.recoveryDelayMs        pause before re-scanning an unresponsive device
     * @param {number}  opts.maxBackoffMs           ceiling on the reconnect back-off
     * @param {number}  opts.noResponseThreshold    consecutive missed polls before the re-bind
     * @param {number}  opts.commandRateMs          minimum spacing between writes
     * @param {number}  opts.maxQueueSize           hard cap on pending writes
     * @param {string}  opts.logLevel
     * @param {object}  [opts.clientOptions]       extra gree-hvac-client options
     *                                             (mac, subUnit, halfDegree, silent, ...)
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
        this.noResponseStreak = 0;
        this.reconnectAttempt = 0;
        this.lastReconnect = null;
        this.queue = new Map();
        this.queueOverflows = 0;
        this.lastSendAt = 0;
        this.sendTimer = null;
        this.deviceId = null;
    }

    start() {
        if (this.client || this.stopped) {
            return;
        }
        const client = this._createClient();
        this.client = client;
        this._setState('connecting');
        this.emit('log', 'info', 'Connecting', { host: this.opts.host });
        // Resolves on the first bind; the client keeps retrying on its own,
        // so a rejection (a failed first scan, a cancel by stop()) is only
        // worth a log line.
        client.connect().catch(error => {
            this.emit('log', 'info', 'Connect attempt ended', {
                reason: error && error.message,
            });
        });
    }

    async stop() {
        this.stopped = true;
        this._clearTimer('sendTimer');
        this.queue.clear();
        this.connected = false;
        this._setState('stopped');
        const client = this.client;
        this.client = null;
        if (!client) {
            return;
        }
        try {
            // after disconnect() the client fires no timer and no event
            // but 'disconnect'
            await client.disconnect();
        } catch (_) {
            // already disconnected
        }
    }

    /**
     * Queue a property write. Returns true if accepted, false if rejected
     * (rejected only when `rejectIfOffline` is true and we're offline).
     *
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
     * Call one of the client's request methods (getProperties,
     * getDeviceInfo, getSubUnits, getVendorProperties, setVendorProperties,
     * getClock, setClock, setName) on the bound client. Unlike `send()`
     * nothing is queued: offline calls reject at once.
     *
     * @param {string} method client method name
     * @param {...*} args
     * @returns {Promise<*>} what the client method resolves with
     */
    call(method, ...args) {
        const client = this.client;
        if (this.stopped || !this.connected || !client) {
            return Promise.reject(new Error('offline'));
        }
        if (typeof client[method] !== 'function') {
            return Promise.reject(new Error('unsupported: ' + method));
        }
        try {
            return Promise.resolve(client[method](...args));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    /**
     * Snapshot for diagnostics output / runtime context.
     *
     * @returns {object} metrics snapshot
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
            reconnectAttempt: this.reconnectAttempt,
            lastReconnect: this.lastReconnect,
            queueSize: this.queue.size,
            queueOverflows: this.queueOverflows,
        };
    }

    _createClient() {
        const client = new this.opts.ClientCtor({
            ...this.opts.clientOptions,
            host: this.opts.host,
            port: this.opts.port,
            pollingInterval: this.opts.pollingIntervalMs,
            pollingTimeout: this.opts.pollingTimeoutMs,
            connectTimeout: this.opts.connectTimeoutMs,
            maxNoResponse: this.opts.noResponseThreshold,
            recoveryDelay: this.opts.recoveryDelayMs,
            reconnectMaxDelay: this.opts.maxBackoffMs,
            reopenSocket: true,
            autoConnect: false,
            logLevel: this.opts.logLevel,
        });

        client.on('connect', () => {
            this.connected = true;
            this.connectedAt = Date.now();
            this.lastContactAt = this.connectedAt;
            this.noResponseStreak = 0;
            this.reconnectAttempt = 0;
            this.deviceId =
                (typeof client.getDeviceId === 'function' &&
                    client.getDeviceId()) ||
                null;
            // bound: a (re-)bind, as opposed to answers resuming
            this._setState('connected', {
                deviceId: this.deviceId,
                bound: true,
            });
            this._scheduleDrain();
        });

        client.on('update', (updated, properties) => {
            this._contact();
            this.emit('update', updated, properties);
            this.emit('diagnostic', {
                event: 'update',
                at: this.lastContactAt,
                updated,
            });
        });

        client.on('success', (updated, properties) => {
            this._contact();
            this.emit('success', updated, properties);
            this.emit('diagnostic', {
                event: 'write_ack',
                at: this.lastContactAt,
                updated,
            });
        });

        client.on('no_response', () => {
            this.noResponseStreak += 1;
            this.emit('log', 'warn', 'No response from device', {
                streak: this.noResponseStreak,
                threshold: this.opts.noResponseThreshold,
            });
            this._setState('no_response', { streak: this.noResponseStreak });
        });

        // The client re-binds by itself: after a connect timeout, after
        // noResponseThreshold missed polls (pausing recoveryDelay first)
        // and after a socket error, each on a new socket.
        client.on('reconnecting', info => {
            const { attempt, delayMs, reason } = info || {};
            this.connected = false;
            this.connectedAt = 0;
            this.reconnectAttempt = attempt || this.reconnectAttempt + 1;
            this.lastReconnect = { at: Date.now(), reason, delayMs };
            this.emit('log', 'info', 'Reconnecting', info);
            // each attempt is reported, also while already reconnecting
            this._setState('reconnecting', { delayMs, reason, attempt }, true);
        });

        // Every client error is informational: the client keeps connecting
        // and recovering until stop().
        client.on('error', error => {
            this.emit('failure', error);
            this.emit('diagnostic', {
                event: 'error',
                at: Date.now(),
                message: error && error.message,
                name: error && error.constructor && error.constructor.name,
            });
        });

        return client;
    }

    _contact() {
        this.lastContactAt = Date.now();
        if (this.noResponseStreak > 0 && this.connected) {
            this.noResponseStreak = 0;
            this._setState('connected', { deviceId: this.deviceId });
        }
        this.noResponseStreak = 0;
    }

    _setState(state, meta, always = false) {
        if (this.state === state && !always) {
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
        const sent = this._setProperties(batch);
        if (!sent) {
            this._scheduleDrain();
            return;
        }
        sent.catch(error => {
            // Surface the write failure to listeners so catch-nodes can
            // see it with the originating payload.
            this.emit('write_failed', error, batch);
            if (isInvalidPropertyError(error)) {
                return; // the device will never take it: no requeue
            }
            // Not sent (e.g. the connection dropped meanwhile): requeue keys
            // the caller has not overwritten since; they go out after the
            // client re-binds.
            for (const [key, value] of Object.entries(batch)) {
                if (!this.queue.has(key)) {
                    this.queue.set(key, value);
                }
            }
            this._enforceQueueLimit();
            this._scheduleDrain();
        });
        if (this.queue.size > 0) {
            this._scheduleDrain();
        }
    }

    /**
     * setProperties() throws ClientInvalidPropertyError synchronously for a
     * value the client refuses (out-of-range setpoint, read-only property,
     * ...). Drop the offending property, report it, and send the rest.
     *
     * @param {object} batch property map, modified in place
     * @returns {Promise|null} the send, or null when nothing was left to send
     */
    _setProperties(batch) {
        for (;;) {
            try {
                return this.client.setProperties(batch);
            } catch (error) {
                const key = error && error.props && error.props.property;
                const known = key !== undefined && key in batch;
                this.emit(
                    'write_failed',
                    error,
                    known ? { [key]: batch[key] } : { ...batch }
                );
                if (!known) {
                    return null;
                }
                delete batch[key];
                if (Object.keys(batch).length === 0) {
                    return null;
                }
            }
        }
    }

    _clearTimer(name) {
        if (this[name]) {
            clearTimeout(this[name]);
            this[name] = null;
        }
    }
}

/**
 * @param {*} error
 * @returns {boolean} the client refused a property or value (it never will take it)
 */
function isInvalidPropertyError(error) {
    return !!(
        error &&
        error.constructor &&
        error.constructor.name === 'ClientInvalidPropertyError'
    );
}

module.exports = { ConnectionManager, isInvalidPropertyError };
