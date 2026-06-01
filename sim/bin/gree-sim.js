#!/usr/bin/env node
'use strict';

const { Simulator } = require('../src/simulator');
const { Dashboard } = require('../src/dashboard');
const { MockSensors } = require('../src/sensors');

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

async function main() {
    const sim = new Simulator({
        port: num(process.env.GREE_SIM_UDP_PORT, 7000),
        bindAddress: process.env.GREE_SIM_BIND || '0.0.0.0',
        cid: process.env.GREE_SIM_CID,
        name: process.env.GREE_SIM_NAME,
        cipherMode: (process.env.GREE_SIM_CIPHER || 'ecb').toLowerCase(),
        deviceKey: process.env.GREE_SIM_DEVICE_KEY,
        faults: {
            dropProbability: num(process.env.GREE_SIM_DROP_PROB, 0),
            dropEvery: num(process.env.GREE_SIM_DROP_EVERY, 0),
            latencyMs: num(process.env.GREE_SIM_LATENCY_MS, 0),
            jitterMs: num(process.env.GREE_SIM_JITTER_MS, 0),
        },
    });

    const sensors = new MockSensors({
        soc: num(process.env.GREE_SIM_SOC, 78),
        batteryVoltage: num(process.env.GREE_SIM_BATT_V, 53.7),
        batterySystemStateNum: num(process.env.GREE_SIM_BATT_STATE, 1),
        insideC: num(process.env.GREE_SIM_INSIDE_C, 24.5),
        outsideC: num(process.env.GREE_SIM_OUTSIDE_C, 22),
    });

    const dashboard = new Dashboard(sim, {
        sensors,
        port: num(process.env.GREE_SIM_HTTP_PORT, 8080),
        bindAddress: process.env.GREE_SIM_HTTP_BIND || '0.0.0.0',
    });

    sim.on('listening', info =>
        console.log(`[sim] UDP listening on ${info.address}:${info.port}`)
    );
    dashboard.on('listening', info =>
        console.log(`[sim] Dashboard at http://${info.address}:${info.port}/`)
    );
    sim.on('protocol-error', e => console.warn('[sim] protocol-error', e));
    sim.on('error', e => console.error('[sim] error', e));

    await sim.start();
    await dashboard.start();

    const shutdown = async signal => {
        console.log(`[sim] received ${signal}, shutting down`);
        await dashboard.stop();
        await sim.stop();
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
    console.error('[sim] fatal', err);
    process.exit(1);
});
