'use strict';

const dgram = require('dgram');

/**
 * Broadcast-scan helper. Sends the Gree discovery packet to the given
 * broadcast address (or 255.255.255.255 by default) and collects raw
 * responses for a fixed listen window. We do not decrypt the responses
 * here — exposing IPs and MAC-style cid fields is enough to populate a
 * config node, and it keeps this utility free of the encryption setup
 * cost.
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

        let socket = null;
        let timer = null;
        let inFlight = false;

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (socket) {
                try {
                    socket.close();
                } catch (_) {
                    /* ignore */
                }
                socket = null;
            }
            inFlight = false;
        };

        node.status({});

        this.on('input', (msg, send, done) => {
            if (inFlight) {
                const err = new Error('Discovery already in progress');
                if (done) done(err);
                else node.error(err, msg);
                return;
            }
            const addr = (msg && msg.broadcastAddress) || broadcastAddress;
            const targetPort = Number(msg && msg.port) || port;
            const windowMs = Math.max(
                500,
                Math.min(30000, Number(msg && msg.windowMs) || listenWindowMs)
            );

            const devices = new Map(); // key: ip+cid

            inFlight = true;
            node.status({
                fill: 'yellow',
                shape: 'dot',
                text: 'scanning ' + addr,
            });

            socket = dgram.createSocket('udp4');

            socket.on('error', error => {
                cleanup();
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: error.message.slice(0, 40),
                });
                if (done) done(error);
                else node.error(error, msg);
            });

            socket.on('message', (buf, rinfo) => {
                let parsed = null;
                try {
                    parsed = JSON.parse(buf.toString());
                } catch (_) {
                    /* ignore malformed */
                }
                const key = rinfo.address + ':' + (parsed && parsed.cid);
                devices.set(key, {
                    address: rinfo.address,
                    port: rinfo.port,
                    cid: parsed && parsed.cid,
                    raw: parsed,
                });
            });

            socket.bind(() => {
                try {
                    socket.setBroadcast(true);
                } catch (error) {
                    cleanup();
                    if (done) done(error);
                    else node.error(error, msg);
                    return;
                }
                const payload = Buffer.from(JSON.stringify({ t: 'scan' }));
                socket.send(
                    payload,
                    0,
                    payload.length,
                    targetPort,
                    addr,
                    sendErr => {
                        if (sendErr) {
                            cleanup();
                            node.status({
                                fill: 'red',
                                shape: 'ring',
                                text: sendErr.message.slice(0, 40),
                            });
                            if (done) done(sendErr);
                            else node.error(sendErr, msg);
                            return;
                        }
                        timer = setTimeout(() => {
                            const list = Array.from(devices.values());
                            cleanup();
                            node.status({
                                fill: 'green',
                                shape: 'dot',
                                text: 'found ' + list.length,
                            });
                            const out = Object.assign({}, msg, {
                                topic: 'gree-discovery',
                                payload: list,
                            });
                            if (send) send(out);
                            else node.send(out);
                            if (done) done();
                        }, windowMs);
                        if (typeof timer.unref === 'function') {
                            timer.unref();
                        }
                    }
                );
            });
        });

        this.on('close', done => {
            cleanup();
            if (done) done();
        });
    }

    RED.nodes.registerType('gree-hvac-discover', GreeHvacDiscoverNode);
};
