'use strict';

const Gree = require('gree-hvac-client');

/**
 * Broadcast-scan helper built on gree-hvac-client's Client.discover(): sends
 * the Gree discovery packet to the given broadcast address (or
 * 255.255.255.255 by default), decrypts the answers that arrive within the
 * listen window and emits one entry per device — enough to populate a config
 * node. With `msg.action = "configureWifi"` it instead joins a unit in AP
 * (setup) mode to a WiFi network (Client.configureWifi()).
 *
 * @param RED
 */
module.exports = function (RED) {
    /**
     *
     * @param config
     */
    function GreeHvacDiscoverNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const broadcastAddress = config.broadcastAddress || '255.255.255.255';
        const port = Number(config.port) || 7000;
        const listenWindowMs = Math.max(
            500,
            Math.min(30000, Number(config.listenWindowMs) || 3000)
        );

        let inFlight = false;
        let closed = false;

        node.status({});

        // inFlight is cleared before done(): a flow may start the next
        // request straight from the reply
        const fail = (error, msg, done) => {
            inFlight = false;
            if (!closed) {
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: String(error.message || error).slice(0, 40),
                });
            }
            if (done) done(error);
            else node.error(error, msg);
        };

        const reply = (msg, send, done, payload, topic) => {
            inFlight = false;
            const out = Object.assign({}, msg, { topic, payload });
            if (send) send(out);
            else node.send(out);
            if (done) done();
        };

        const scan = (msg, send, done) => {
            const addr = (msg && msg.broadcastAddress) || broadcastAddress;
            const targetPort = Number(msg && msg.port) || port;
            const windowMs = Math.max(
                500,
                Math.min(30000, Number(msg && msg.windowMs) || listenWindowMs)
            );

            node.status({
                fill: 'yellow',
                shape: 'dot',
                text: 'scanning ' + addr,
            });

            return Gree.Client.discover({
                host: addr,
                port: targetPort,
                timeout: windowMs,
            }).then(
                devices => {
                    if (closed) return;
                    const list = devices.map(d => ({
                        mac: d.mac,
                        // the field name of earlier releases, kept for flows
                        // that read it
                        cid: d.mac,
                        name: d.name,
                        address: d.address,
                        port: targetPort,
                        version: d.version,
                        subUnits: d.subUnits,
                        pack: d.pack,
                    }));
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: 'found ' + list.length,
                    });
                    reply(msg, send, done, list, 'gree-discovery');
                },
                error => fail(error, msg, done)
            );
        };

        const configureWifi = (msg, send, done) => {
            const p = (msg && msg.payload) || {};
            if (!p.ssid || typeof p.password !== 'string') {
                fail(
                    new Error(
                        'configureWifi: payload must be {ssid, password[, host]}'
                    ),
                    msg,
                    done
                );
                return Promise.resolve();
            }
            node.status({
                fill: 'yellow',
                shape: 'dot',
                text: 'WiFi setup → ' + p.ssid,
            });
            return Gree.Client.configureWifi({
                ssid: p.ssid,
                password: p.password,
                ...(p.host && { host: p.host }),
                port: Number(msg.port) || port,
            }).then(
                result => {
                    if (closed) return;
                    node.status({
                        fill: result.confirmed ? 'green' : 'yellow',
                        shape: 'dot',
                        text: result.confirmed
                            ? 'joined ' + p.ssid
                            : 'no confirmation',
                    });
                    // never echo the password back into the flow
                    const out = Object.assign({}, msg);
                    delete out.payload;
                    reply(out, send, done, result, 'gree-wifi-setup');
                },
                error => fail(error, msg, done)
            );
        };

        this.on('input', (msg, send, done) => {
            if (inFlight) {
                const err = new Error('Discovery already in progress');
                if (done) done(err);
                else node.error(err, msg);
                return;
            }
            const action = msg && msg.action;
            if (action && action !== 'discover' && action !== 'configureWifi') {
                const err = new Error(
                    'Unknown action "' +
                        action +
                        '", expected discover or configureWifi'
                );
                if (done) done(err);
                else node.error(err, msg);
                return;
            }
            inFlight = true;
            (action === 'configureWifi' ? configureWifi : scan)(
                msg,
                send,
                done
            ).finally(() => {
                // closed while in flight: nothing replied
                inFlight = false;
            });
        });

        this.on('close', done => {
            closed = true;
            if (done) done();
        });
    }

    RED.nodes.registerType('gree-hvac-discover', GreeHvacDiscoverNode);
};
