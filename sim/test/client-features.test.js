'use strict';

// The gree-hvac-client 4.2/4.3 features, exercised through the real
// installed client against the simulator: optional properties and their
// probing, Fahrenheit and half-degree setpoints, firmware id, clock, name,
// beeper, multi-split sub-units, discovery and WiFi setup.

const test = require('node:test');
const assert = require('node:assert/strict');

const { Simulator } = require('../src/simulator');
const { displaySetpoint } = require('../src/transformer');
const Gree = require('gree-hvac-client');

const startSim = async (t, opts) => {
    const sim = new Simulator({ port: 0, bindAddress: '127.0.0.1', ...opts });
    await sim.start();
    t.after(() => sim.stop());
    return sim;
};

const connect = async (t, sim, opts = {}) => {
    const client = new Gree.Client({
        host: '127.0.0.1',
        port: sim.port,
        autoConnect: false,
        poll: false,
        connectTimeout: 4000,
        pollingTimeout: 2000,
        commandInterval: 0,
        ...opts,
    });
    client.on('error', () => {});
    t.after(async () => {
        try {
            await client.disconnect();
        } catch (_) {
            /* already disconnected */
        }
    });
    await client.connect();
    return client;
};

const waitFor = async (check, ms = 3000) => {
    const until = Date.now() + ms;
    while (!check()) {
        if (Date.now() > until) throw new Error('timed out waiting');
        await new Promise(r => setTimeout(r, 20));
    }
};

const waitEvent = (emitter, event, ms = 3000) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`timed out waiting for "${event}"`)),
            ms
        );
        emitter.once(event, payload => {
            clearTimeout(timer);
            resolve(payload);
        });
    });

test('optional properties: only the features the unit has are polled', async t => {
    const sim = await startSim(t, {
        features: 'outdoorTemperature,humidity',
        initialState: { OutEnvTem: 61, DwatSen: 52 },
    });
    const client = await connect(t, sim);
    // the client probes each optional code once after the bind
    await waitFor(() => client._supportedOptionalCodes.size === 2);

    const properties = await client.getProperties();
    assert.equal(properties.outdoorTemperature, 21);
    assert.equal(properties.humidity, 52);
    for (const absent of [
        'antiDirectBlow',
        'errorCode',
        'targetHumidity',
        'humidityMode',
        'lightSensor',
        'waterFull',
        'cleanFilter',
    ]) {
        assert.ok(!(absent in properties), `${absent} should be absent`);
    }
});

test('optional properties are reported and settable when the unit has them', async t => {
    const sim = await startSim(t, {
        initialState: {
            OutEnvTem: 35,
            DwatSen: 61,
            AllErr: 7,
            Dwet: 55,
            DwatFul: 1,
            Dfltr: 1,
            Dmod: 2,
            LigSen: 0,
        },
    });
    const client = await connect(t, sim);
    await waitFor(() => client._supportedOptionalCodes.size === 9);

    const p = await client.getProperties();
    assert.equal(p.outdoorTemperature, -5);
    assert.equal(p.humidity, 61);
    assert.equal(p.errorCode, 7);
    assert.equal(p.targetHumidity, 55);
    assert.equal(p.waterFull, 'on');
    assert.equal(p.cleanFilter, 'on');
    assert.equal(p.humidityMode, 'smart');
    assert.equal(p.lightSensor, 'on');
    assert.equal(p.antiDirectBlow, 'off');

    const success = waitEvent(client, 'success');
    await client.setProperties({
        antiDirectBlow: 'on',
        humidityMode: 'off',
        targetHumidity: 40,
        lightSensor: 'off',
    });
    const acked = await success;
    assert.equal(acked.antiDirectBlow, 'on');
    assert.equal(sim.state.all.AntiDirectBlow, 1);
    assert.equal(sim.state.all.Dmod, 15);
    assert.equal(sim.state.all.Dwet, 40);
    assert.equal(sim.state.all.LigSen, 1);

    // a change on the unit itself reaches the client as an update
    const update = waitEvent(client, 'update');
    sim.state.apply(['AllErr'], [0], 'test');
    await client.getProperties();
    assert.equal((await update).errorCode, 0);
});

test('encodedTargetHumidity sends (% − 15) / 5 like an Airy Pro', async t => {
    const sim = await startSim(t);
    const client = await connect(t, sim, { encodedTargetHumidity: true });
    const success = waitEvent(client, 'success');
    await client.setProperties({ targetHumidity: 55 });
    await success;
    assert.equal(sim.state.all.Dwet, 8);
});

test('Fahrenheit setpoints go out as SetTem °C + TemRec', async t => {
    const sim = await startSim(t);
    const client = await connect(t, sim);

    const success = waitEvent(client, 'success');
    await client.setProperties({
        temperatureUnit: 'fahrenheit',
        temperature: 76,
    });
    assert.equal((await success).temperature, 76);
    assert.equal(sim.state.all.TemUn, 1);
    assert.equal(sim.state.all.SetTem, 24);
    assert.equal(sim.state.all.TemRec, 1);
    assert.deepEqual(displaySetpoint(sim.state.all), {
        value: 76,
        unit: '°F',
    });

    // 75 °F is the same 24 °C with TemRec 0
    sim.state.apply(['TemRec'], [0], 'test');
    assert.equal((await client.getProperties()).temperature, 75);
});

test('halfDegree setpoints use Add0.5', async t => {
    const sim = await startSim(t);
    const client = await connect(t, sim, { halfDegree: true });
    const success = waitEvent(client, 'success');
    await client.setProperties({ temperature: 23.5 });
    await success;
    assert.equal(sim.state.all.SetTem, 23);
    assert.equal(sim.state.all['Add0.5'], 1);
    assert.equal((await client.getProperties()).temperature, 23.5);
    assert.deepEqual(displaySetpoint(sim.state.all), {
        value: 23.5,
        unit: '°C',
    });
});

test('getDeviceInfo reads the firmware id (hid) and module version', async t => {
    const sim = await startSim(t, { cid: 'a1b2c3d4e5f6', version: 'V1.1.13' });
    const client = await connect(t, sim);
    const info = await client.getDeviceInfo();
    assert.equal(info.mac, 'a1b2c3d4e5f6');
    assert.equal(info.version, 'V1.1.13');
    assert.equal(info.hid, '362001000762+U-CS532AE(LT)V3.31.bin');
    assert.equal(info.firmwareVersion, '3.31');
    assert.equal(info.upgradeWarning, undefined);
});

test('getDeviceInfo warns for a firmware with cloud-only builds', async t => {
    const sim = await startSim(t, { hid: '362001066300+4MWB05DF13V3.05.bin' });
    const client = await connect(t, sim);
    const info = await client.getDeviceInfo();
    assert.equal(info.firmwareCode, '362001066300');
    assert.match(info.upgradeWarning, /cloud-only/);
});

test('a unit without a firmware id leaves hid out', async t => {
    const sim = await startSim(t, { hid: '' });
    const client = await connect(t, sim);
    const info = await client.getDeviceInfo();
    assert.equal(info.hid, undefined);
});

test('clock can be read and set; it keeps running', async t => {
    const sim = await startSim(t);
    const client = await connect(t, sim);
    assert.match(await client.getClock(), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);

    await client.setClock(new Date(2030, 0, 2, 3, 4, 5));
    await waitFor(() => sim.clock.startsWith('2030-01-02 03:04:0'));
    assert.match(await client.getClock(), /^2030-01-02 03:04:0\d$/);
    // the clock is no device property
    assert.equal(sim.state.all.time, undefined);
});

test('setName renames the unit, as discovery shows', async t => {
    const sim = await startSim(t, { cid: 'abcdef012345' });
    const client = await connect(t, sim);
    await client.setName('Bedroom');
    await waitFor(() => sim.name === 'Bedroom');
    assert.deepEqual(await client.getVendorProperties(['name']), {
        name: 'Bedroom',
    });

    const devices = await Gree.Client.discover({
        host: '127.0.0.1',
        port: sim.port,
        timeout: 300,
    });
    assert.equal(devices.length, 1);
    assert.equal(devices[0].mac, 'abcdef012345');
    assert.equal(devices[0].name, 'Bedroom');
    assert.equal(devices[0].subUnits, 0);
});

test('raw vendor codes: unknown ones are left out of the answer', async t => {
    const sim = await startSim(t, { initialState: { UvcControl: 1 } });
    const client = await connect(t, sim);
    assert.deepEqual(
        await client.getVendorProperties(['UvcControl', 'NoSuchCode']),
        { UvcControl: 1 }
    );
    await client.setVendorProperties({ UvcControl: 0 });
    await waitFor(() => sim.state.all.UvcControl === 0);
});

test('silent option sends the beeper flags, which are not stored', async t => {
    const sim = await startSim(t);
    const quiet = await connect(t, sim, { silent: true });
    let success = waitEvent(quiet, 'success');
    await quiet.setProperties({ lights: 'on' });
    await success;
    assert.equal(sim.lastCommand.silent, true);
    assert.equal(sim.state.all.Buzzer_ON_OFF, undefined);
    assert.equal(sim.state.all.BuzzerCtrl, undefined);

    const loud = await connect(t, sim);
    success = waitEvent(loud, 'success');
    await loud.setProperties({ lights: 'off' });
    await success;
    assert.equal(sim.lastCommand.silent, false);
});

test('multi-split: list the indoor units and control one of them', async t => {
    const sim = await startSim(t, { cid: '00aa00bb00cc', subUnits: 2 });
    const devices = await Gree.Client.discover({
        host: '127.0.0.1',
        port: sim.port,
        timeout: 300,
    });
    assert.equal(devices[0].subUnits, 2);

    const gateway = await connect(t, sim);
    const units = await gateway.getSubUnits();
    assert.deepEqual(
        units.map(u => u.mac),
        ['00aa00bb00cc01', '00aa00bb00cc02']
    );

    const mac = units[1].mac;
    sim.unitState(mac).apply(['SetTem'], [19], 'test');
    const indoor = await connect(t, sim, { subUnit: mac });
    assert.equal((await indoor.getProperties()).temperature, 19);

    const success = waitEvent(indoor, 'success');
    await indoor.setProperties({ power: 'on' });
    await success;
    assert.equal(sim.unitState(mac).all.Pow, 1);
    assert.equal(sim.state.all.Pow, 0, 'the gateway itself is untouched');
    assert.equal(sim.lastCommand.unit, mac);
});

test('a single unit answers the sub-unit list empty', async t => {
    const sim = await startSim(t);
    const client = await connect(t, sim);
    assert.deepEqual(await client.getSubUnits({ timeout: 500 }), []);
});

test('configureWifi: a unit in AP mode confirms the network', async t => {
    const sim = await startSim(t, { cid: 'feedfacecafe' });
    const result = await Gree.Client.configureWifi({
        ssid: 'home',
        password: 'secret',
        host: '127.0.0.1',
        port: sim.port,
        timeout: 1000,
    });
    assert.deepEqual(result, { confirmed: true, mac: 'feedfacecafe' });
    assert.equal(sim.wifi.ssid, 'home');
    assert.ok(!JSON.stringify(sim.wifi).includes('secret'));
});

test('GCM units answer the new requests too', async t => {
    const sim = await startSim(t, { cipherMode: 'gcm', subUnits: 1 });
    const client = await connect(t, sim);
    assert.equal((await client.getSubUnits()).length, 1);
    assert.equal((await client.getDeviceInfo()).firmwareVersion, '3.31');
});
