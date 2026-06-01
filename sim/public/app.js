'use strict';

const $ = sel => document.querySelector(sel);

function renderState(s) {
    $('#dev-name').textContent = s.name;
    $('#dev-cid').textContent = s.cid;
    $('#dev-cipher').textContent = `cipher: ${s.cipher}`;

    const f = s.friendly;
    const power = f.power === 'on';
    $('#power-pill').textContent = power ? 'ON' : 'OFF';
    $('#power-pill').classList.toggle('on', power);

    $('#setpoint-val').textContent =
        typeof f.temperature === 'number' ? f.temperature : '--';
    $('#current-val').textContent =
        s.currentTemperatureC === null ? '--' : s.currentTemperatureC.toFixed(1);
    $('#mode-val').textContent = f.mode || '--';
    $('#fan-val').textContent = f.fanSpeed || '--';
    $('#swingH-val').textContent = f.swingHor || '--';
    $('#swingV-val').textContent = f.swingVert || '--';

    toggleBadge('badge-turbo', f.turbo === 'on');
    toggleBadge('badge-quiet', f.quiet && f.quiet !== 'off');
    toggleBadge('badge-sleep', f.sleep === 'on');
    toggleBadge('badge-blow', f.blow === 'on');
    toggleBadge('badge-health', f.health === 'on');
    toggleBadge('badge-light', f.lights === 'on');
    toggleBadge('badge-powersave', f.powerSave === 'on');
}

function toggleBadge(id, on) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!on);
}

function renderStats(stats) {
    $('#stats').textContent = JSON.stringify(stats, null, 2);
}

function renderFaults(f) {
    $('#dropProb').value = f.dropProbability;
    $('#dropEvery').value = f.dropEvery;
    $('#latency').value = f.latencyMs;
    $('#jitter').value = f.jitterMs;
}

function renderSensors(s) {
    if (!s) return;
    $('#s-soc').value = s.soc;
    $('#s-volt').value = s.batteryVoltage;
    $('#s-bstate').value = s.batterySystemStateNum;
    $('#s-inside').value = s.insideC;
    $('#s-outside').value = s.outsideC;
}

async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
}

async function init() {
    try {
        const [state, stats, faults, sensors] = await Promise.all([
            fetchJson('/api/state'),
            fetchJson('/api/stats'),
            fetchJson('/api/faults'),
            fetchJson('/api/sensors').catch(() => null),
        ]);
        renderState(state);
        renderStats(stats);
        renderFaults(faults);
        renderSensors(sensors);
    } catch (e) {
        console.error('initial load failed', e);
    }

    const es = new EventSource('/api/events');
    es.addEventListener('state', e => {
        const payload = JSON.parse(e.data);
        // payload from sim is {changed, state}; refetch the snapshot to keep render simple
        fetchJson('/api/state').then(renderState).catch(() => {});
    });
    es.addEventListener('stats', e => renderStats(JSON.parse(e.data)));
    es.addEventListener('sensors', e => renderSensors(JSON.parse(e.data)));
    es.onerror = () => {
        // EventSource auto-reconnects; nothing to do
    };

    $('#tempBtn').addEventListener('click', async () => {
        const c = Number($('#tempInput').value);
        if (!Number.isFinite(c)) return;
        try {
            const s = await fetchJson('/api/temperature', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ celsius: c }),
            });
            renderState(s);
        } catch (e) {
            alert('failed: ' + e.message);
        }
    });

    $('#sensorsBtn').addEventListener('click', async () => {
        const body = {
            soc: Number($('#s-soc').value),
            batteryVoltage: Number($('#s-volt').value),
            batterySystemStateNum: Number($('#s-bstate').value),
            insideC: Number($('#s-inside').value),
            outsideC: Number($('#s-outside').value),
        };
        try {
            const s = await fetchJson('/api/sensors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            renderSensors(s);
        } catch (e) {
            alert('failed: ' + e.message);
        }
    });

    $('#faultsBtn').addEventListener('click', async () => {
        const body = {
            dropProbability: Number($('#dropProb').value),
            dropEvery: Number($('#dropEvery').value),
            latencyMs: Number($('#latency').value),
            jitterMs: Number($('#jitter').value),
        };
        try {
            const f = await fetchJson('/api/faults', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            renderFaults(f);
        } catch (e) {
            alert('failed: ' + e.message);
        }
    });
}

init();
