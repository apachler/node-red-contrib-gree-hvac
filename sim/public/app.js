'use strict';

const $ = sel => document.querySelector(sel);

// Last full state snapshot, so the control widgets know the current vendor
// values (e.g. to toggle power or step the setpoint relative to "now").
let lastState = null;

/**
 *
 * @param s
 */
function renderState(s) {
    lastState = s;
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
        s.currentTemperatureC === null
            ? '--'
            : s.currentTemperatureC.toFixed(1);
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

    renderControls(s);
    renderLastChange(s.lastChange);
}

const SOURCE_LABELS = {
    udp: 'Gree UDP protocol',
    http: 'HTTP API',
    sim: 'Simulator',
};
let lastChangeAt = null;

/**
 * Show the origin of the most recent state change and briefly flash when a
 * new change arrives, so flow-driven changes are distinguishable from
 * direct dashboard actions.
 * @param lc
 */
function renderLastChange(lc) {
    const pill = $('#lastchange-src');
    const detail = $('#lastchange-detail');
    if (!pill || !detail) return;
    if (!lc) {
        pill.textContent = '—';
        pill.className = 'src-pill';
        detail.textContent = '';
        return;
    }
    pill.textContent = SOURCE_LABELS[lc.source] || lc.source;
    pill.className = 'src-pill ' + lc.source;
    const t = new Date(lc.at);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    detail.textContent = `· ${hh}:${mm}:${ss} · ${(lc.keys || []).join(', ')}`;

    if (lc.at !== lastChangeAt) {
        lastChangeAt = lc.at;
        const row = document.querySelector('.lastchange');
        if (row) {
            row.classList.remove('flash');
            // reflow to restart the animation
            void row.offsetWidth;
            row.classList.add('flash');
        }
    }
}

/**
 * Sync the direct-control widgets with the live state.
 * @param s
 */
function renderControls(s) {
    const v = s.vendor || {};
    const power = s.friendly.power === 'on';
    const powerBtn = $('#ac-power');
    if (powerBtn) {
        powerBtn.textContent = power ? 'Turn off' : 'Turn on';
        powerBtn.classList.toggle('ctl-power', power);
    }
    setSelect('#ac-mode', v.Mod);
    setSelect('#ac-fan', v.WdSpd);
    setSelect('#ac-swingv', v.SwUpDn);
    setSelect('#ac-lights', v.Lig);
    const temp = $('#ac-temp-val');
    if (temp) {
        temp.textContent =
            typeof v.SetTem === 'number' ? `${v.SetTem}°C` : '--°C';
    }
}

/**
 * @param sel
 * @param value
 */
function setSelect(sel, value) {
    const el = $(sel);
    if (el && value !== undefined && value !== null) el.value = String(value);
}

/**
 *
 * @param id
 * @param on
 */
function toggleBadge(id, on) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!on);
}

/**
 *
 * @param stats
 */
function renderStats(stats) {
    $('#stats').textContent = JSON.stringify(stats, null, 2);
}

/**
 *
 * @param f
 */
function renderFaults(f) {
    $('#dropProb').value = f.dropProbability;
    $('#dropEvery').value = f.dropEvery;
    $('#latency').value = f.latencyMs;
    $('#jitter').value = f.jitterMs;
}

/**
 *
 * @param s
 */
function renderSensors(s) {
    if (!s) return;
    $('#s-soc').value = s.soc;
    $('#s-volt').value = s.batteryVoltage;
    $('#s-bstate').value = s.batterySystemStateNum;
    $('#s-inside').value = s.insideC;
    $('#s-outside').value = s.outsideC;
}

/**
 * @param url
 * @param opts
 * @returns {Promise<any>}
 */
async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
}

/**
 *
 */
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
        fetchJson('/api/state')
            .then(renderState)
            .catch(() => {});
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

    // --- Direct AC control (writes vendor codes straight to /api/set) ---

    $('#ac-power').addEventListener('click', () => {
        const on = lastState && lastState.friendly.power === 'on';
        setAc({ Pow: on ? 0 : 1 });
    });
    $('#ac-temp-up').addEventListener('click', () => stepTemp(1));
    $('#ac-temp-down').addEventListener('click', () => stepTemp(-1));
    $('#ac-mode').addEventListener('change', e =>
        setAc({ Mod: Number(e.target.value) })
    );
    $('#ac-fan').addEventListener('change', e =>
        setAc({ WdSpd: Number(e.target.value) })
    );
    $('#ac-swingv').addEventListener('change', e =>
        setAc({ SwUpDn: Number(e.target.value) })
    );
    $('#ac-lights').addEventListener('change', e =>
        setAc({ Lig: Number(e.target.value) })
    );
}

/**
 * Step the setpoint relative to the current value (clamped 16–30°C).
 * @param delta
 */
function stepTemp(delta) {
    const cur =
        lastState && typeof lastState.vendor.SetTem === 'number'
            ? lastState.vendor.SetTem
            : 24;
    const next = Math.max(16, Math.min(30, cur + delta));
    setAc({ SetTem: next });
}

/**
 * POST vendor property codes to the simulator's /api/set. The SSE 'state'
 * event then refreshes the display, but we also render the response so the
 * UI updates immediately.
 * @param vendorProps
 */
async function setAc(vendorProps) {
    try {
        const s = await fetchJson('/api/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vendorProps),
        });
        renderState(s);
    } catch (e) {
        alert('failed: ' + e.message);
    }
}

init();
