'use strict';

const $ = sel => document.querySelector(sel);

// Last full state snapshot, so the control widgets know the current vendor
// values (e.g. to toggle power or step the setpoint relative to "now").
let lastState = null;

// Indoor unit shown and controlled on a multi-split gateway (null = the unit)
let currentUnit = null;

// Optional features, in the order the client probes them
const FEATURE_LABELS = {
    AntiDirectBlow: 'anti-direct blow',
    OutEnvTem: 'outdoor temp',
    DwatSen: 'humidity sensor',
    AllErr: 'fault code',
    Dwet: 'target humidity',
    DwatFul: 'water full',
    Dfltr: 'clean filter',
    Dmod: 'humidity mode',
    LigSen: 'light sensor',
};

const HUMIDITY_MODES = { 15: 'off', 0: 'target', 1: 'continuous', 2: 'smart' };

/**
 * @param {string} path
 * @returns {string} path addressing the current indoor unit, if any
 */
function withUnit(path) {
    return currentUnit
        ? `${path}?unit=${encodeURIComponent(currentUnit)}`
        : path;
}

/**
 *
 * @param s
 */
function renderState(s) {
    lastState = s;
    $('#dev-name').textContent = s.name;
    $('#dev-cid').textContent = s.cid;
    $('#dev-cipher').textContent = `cipher: ${s.cipher}`;
    $('#dev-version').textContent = s.version || '—';

    const f = s.friendly;
    const v = s.vendor || {};
    const has = code => (s.features || []).includes(code);
    const power = f.power === 'on';
    $('#power-pill').textContent = power ? 'ON' : 'OFF';
    $('#power-pill').classList.toggle('on', power);

    const sp = s.setpoint || {};
    $('#setpoint-val').textContent =
        typeof sp.value === 'number' ? sp.value : '--';
    $('#setpoint-unit').textContent = sp.unit || '°C';
    $('#current-val').textContent =
        s.currentTemperatureC === null
            ? '--'
            : s.currentTemperatureC.toFixed(1);
    $('#outdoor-row').hidden = !has('OutEnvTem');
    $('#outdoor-val').textContent =
        s.outdoorTemperatureC === null ? '--' : s.outdoorTemperatureC;
    $('#humidity-row').hidden = !has('DwatSen');
    $('#humidity-val').textContent = v.DwatSen ?? '--';
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
    toggleBadge(
        'badge-antidirect',
        f.antiDirectBlow === 'on',
        has('AntiDirectBlow')
    );
    toggleBadge('badge-lightsensor', f.lightSensor === 'on', has('LigSen'));
    toggleBadge(
        'badge-humiditymode',
        v.Dmod !== undefined && v.Dmod !== 15,
        has('Dmod')
    );
    $('#badge-humiditymode').textContent =
        'dry: ' + (HUMIDITY_MODES[v.Dmod] ?? v.Dmod);
    toggleBadge('badge-waterfull', v.DwatFul === 1, has('DwatFul'));
    toggleBadge('badge-cleanfilter', v.Dfltr === 1, has('Dfltr'));
    toggleBadge('badge-error', !!v.AllErr, has('AllErr'));
    $('#badge-error').textContent = `error ${v.AllErr ?? 0}`;

    renderControls(s);
    renderDevice(s);
    renderLastChange(s.lastChange, s.lastCommand);
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
 * direct dashboard actions. A Gree command also shows whether it asked the
 * unit not to beep.
 *
 * @param lc
 * @param cmd
 */
function renderLastChange(lc, cmd) {
    const pill = $('#lastchange-src');
    const detail = $('#lastchange-detail');
    const beep = $('#lastcmd-beep');
    if (!pill || !detail) return;
    if (beep) {
        beep.hidden = !cmd;
        if (cmd) {
            beep.textContent = cmd.silent ? 'silent' : 'beep';
            beep.className = 'src-pill' + (cmd.silent ? ' silent' : '');
        }
    }
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
 *
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
    for (const [sel, code] of Object.entries(AC_NUMBERS)) {
        const el = $('#' + sel);
        // don't overwrite what the user is typing
        if (el && document.activeElement !== el && v[code] !== undefined) {
            el.value = String(v[code]);
        }
    }
    const temp = $('#ac-temp-val');
    if (temp) {
        temp.textContent =
            typeof v.SetTem === 'number' ? `${v.SetTem}°C` : '--°C';
    }

    const units = s.subUnits || [];
    $('#unit-row').hidden = units.length === 0;
    const select = $('#ac-unit');
    const options = [{ mac: '', label: `${s.cid} (gateway)` }].concat(
        units.map(u => ({ mac: u.mac, label: u.mac }))
    );
    if (select.options.length !== options.length) {
        select.innerHTML = '';
        for (const o of options) {
            const opt = document.createElement('option');
            opt.value = o.mac;
            opt.textContent = o.label;
            select.appendChild(opt);
        }
    }
    select.value = s.unit || '';
}

/**
 * Device identity, clock, WiFi setup and optional features.
 *
 * @param s
 */
function renderDevice(s) {
    $('#dev-hid').textContent = s.hid || '— (not reported)';
    $('#dev-clock').textContent = s.clock || '—';
    $('#dev-wifi').textContent = s.wifi
        ? `joined “${s.wifi.ssid}” at ${new Date(s.wifi.at).toLocaleTimeString()}`
        : '— (no setup request)';
    const units = s.subUnits || [];
    $('#dev-subunits').textContent = units.length
        ? units.map(u => u.mac).join(', ')
        : '— (single unit)';
    const nameInput = $('#nameInput');
    if (document.activeElement !== nameInput) nameInput.value = s.name;

    const box = $('#features');
    if (!box.children.length) {
        for (const [code, label] of Object.entries(FEATURE_LABELS)) {
            const l = document.createElement('label');
            l.innerHTML = `<input type="checkbox" value="${code}" /> ${label}`;
            box.appendChild(l);
        }
    }
    for (const input of box.querySelectorAll('input')) {
        input.checked = (s.features || []).includes(input.value);
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
    'ac-halfdegree': 'Add0.5',
    'ac-antidirect': 'AntiDirectBlow',
    'ac-lightsensor': 'LigSen',
    'ac-humiditymode': 'Dmod',
    'ac-waterfull': 'DwatFul',
    'ac-cleanfilter': 'Dfltr',
};

// Maps each direct-control number <input> to its Gree vendor property code.
const AC_NUMBERS = {
    'ac-targethumidity': 'Dwet',
    'ac-humidity': 'DwatSen',
    'ac-errorcode': 'AllErr',
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
 * @param [available] hide the badge when the unit lacks the feature
 */
function toggleBadge(id, on, available = true) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.toggle('on', !!on);
        el.hidden = !available;
    }
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
    // the unit's clock keeps ticking: refresh it with the stats heartbeat
    if (lastState) refreshState();
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
 * Re-read the snapshot of the current unit.
 */
function refreshState() {
    fetchJson(withUnit('/api/state'))
        .then(renderState)
        .catch(() => {});
}

/**
 * POST a JSON body to a state-changing endpoint and render the answer.
 *
 * @param path
 * @param body
 */
async function post(path, body) {
    try {
        const s = await fetchJson(withUnit(path), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        renderState(s);
    } catch (e) {
        alert('failed: ' + e.message);
    }
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
    // payload from sim is {changed, state}; refetch the snapshot to keep render simple
    es.addEventListener('state', refreshState);
    es.addEventListener('stats', e => renderStats(JSON.parse(e.data)));
    es.onerror = () => {
        // EventSource auto-reconnects; nothing to do
    };

    $('#tempBtn').addEventListener('click', () => {
        const c = Number($('#tempInput').value);
        if (Number.isFinite(c)) post('/api/temperature', { celsius: c });
    });
    $('#outdoorBtn').addEventListener('click', () => {
        const c = Number($('#outdoorInput').value);
        if (Number.isFinite(c))
            post('/api/outdoor-temperature', { celsius: c });
    });
    $('#nameBtn').addEventListener('click', () =>
        post('/api/name', { name: $('#nameInput').value })
    );
    // the browser's local time, as gree-hvac-client's setClock() sends it
    $('#clockBtn').addEventListener('click', () => {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        const time =
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
            `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        post('/api/clock', { time });
    });
    $('#featuresBtn').addEventListener('click', () => {
        const features = [...document.querySelectorAll('#features input')]
            .filter(i => i.checked)
            .map(i => i.value);
        post('/api/features', { features });
    });
    $('#ac-unit').addEventListener('change', e => {
        currentUnit = e.target.value || null;
        refreshState();
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
    for (const [sel, code] of Object.entries({
        ...AC_SELECTS,
        ...AC_NUMBERS,
    })) {
        const el = $('#' + sel);
        if (el) {
            el.addEventListener('change', e => {
                const value = Number(e.target.value);
                if (Number.isFinite(value)) setAc({ [code]: value });
            });
        }
    }
}

/**
 * Step the setpoint relative to the current value (clamped 16–30°C).
 *
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
 *
 * @param vendorProps
 * @returns {Promise<void>}
 */
function setAc(vendorProps) {
    return post('/api/set', vendorProps);
}

init();
