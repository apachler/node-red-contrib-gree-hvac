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
    for (const [sel, code] of Object.entries(AC_SELECTS)) {
        setSelect('#' + sel, v[code]);
    }
    const temp = $('#ac-temp-val');
    if (temp) {
        temp.textContent =
            typeof v.SetTem === 'number' ? `${v.SetTem}°C` : '--°C';
    }
}

// Maps each direct-control <select> to its Gree vendor property code.
const AC_SELECTS = {
    'ac-mode': 'Mod',
    'ac-fan': 'WdSpd',
    'ac-tempunit': 'TemUn',
    'ac-air': 'Air',
    'ac-swingh': 'SwingLfRig',
    'ac-swingv': 'SwUpDn',
    'ac-quiet': 'Quiet',
    'ac-lights': 'Lig',
    'ac-blow': 'Blo',
    'ac-health': 'Health',
    'ac-sleep': 'SwhSlp',
    'ac-turbo': 'Tur',
    'ac-powersave': 'SvSt',
    'ac-safety': 'StHt',
};

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
    const summary = $('#stat-summary');
    if (summary) {
        const age = stats.lastActivityAt
            ? Math.round((Date.now() - stats.lastActivityAt) / 1000) + 's ago'
            : '—';
        const rows = [
            ['Uptime', (stats.uptimeSeconds || 0) + 's', false],
            [
                'Drop rate',
                (stats.dropRate || 0) + '%',
                (stats.dropRate || 0) > 0,
            ],
            [
                'Rx / Tx',
                (stats.packetsRx || 0) + ' / ' + (stats.packetsTx || 0),
                false,
            ],
            [
                'Dropped',
                stats.packetsDropped || 0,
                (stats.packetsDropped || 0) > 0,
            ],
            ['Commands', stats.commands || 0, false],
            ['Errors', stats.errors || 0, (stats.errors || 0) > 0],
            ['Last activity', age, false],
        ];
        summary.innerHTML = rows
            .map(
                ([k, v, warn]) =>
                    `<span class="pair"><span class="k">${k}</span><span class="v${
                        warn ? ' warn' : ''
                    }">${v}</span></span>`
            )
            .join('');
    }
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
        const [state, stats, faults] = await Promise.all([
            fetchJson('/api/state'),
            fetchJson('/api/stats'),
            fetchJson('/api/faults'),
        ]);
        renderState(state);
        renderStats(stats);
        renderFaults(faults);
    } catch (e) {
        console.error('initial load failed', e);
    }

    const es = new EventSource('/api/events');
    es.addEventListener('state', () => {
        // payload from sim is {changed, state}; refetch the snapshot to keep render simple
        fetchJson('/api/state')
            .then(renderState)
            .catch(() => {});
    });
    es.addEventListener('stats', e => renderStats(JSON.parse(e.data)));
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

    $('#statsResetBtn').addEventListener('click', async () => {
        try {
            const s = await fetchJson('/api/stats/reset', { method: 'POST' });
            renderStats(s);
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
    for (const [sel, code] of Object.entries(AC_SELECTS)) {
        const el = $('#' + sel);
        if (el) {
            el.addEventListener('change', e =>
                setAc({ [code]: Number(e.target.value) })
            );
        }
    }
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
