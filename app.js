import * as M from './model.js';
import * as S from './store.js';
import { T, setLang, getLang } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => Date.now();
const main = $('#main');

const DEFAULT = () => ({ v: 1, settings: { lang: null, mode: 'walk', walk: 5, bike: 16, minLeft: 3 }, lights: [], places: [], routes: [], ui: {} });
let state, photos = {};

// ---------- persistence ----------
async function save() {
  try { await S.put('kv', 'state', state); } catch (e) { console.error(e); toast(T('saveFailed')); }
}
const mcache = new Map();
function commit() { mcache.clear(); save(); }
function model(l) {
  if (!mcache.has(l.id)) mcache.set(l.id, M.lightModel(l));
  return mcache.get(l.id);
}
const models = () => Object.fromEntries(state.lights.map(l => [l.id, model(l)]));
const light = id => state.lights.find(l => l.id === id);
const place = id => state.places.find(p => p.id === id);
const routeOf = id => state.routes.find(r => r.id === id);
const byId = () => Object.fromEntries([...state.lights, ...state.places].map(x => [x.id, x]));

// ---------- formatting ----------
const loc = () => getLang() === 'he' ? 'he-IL' : 'en-GB';
const hms = t => new Date(t).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const hm = t => new Date(t).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', hour12: false });
const dur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const kmh = mps => (mps * 3.6).toFixed(1);
const meters = m => m < 1000 ? `${Math.round(m / 10) * 10} ${T('m')}` : `${(m / 1000).toFixed(1)} ${T('km')}`;
function ago(t) {
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' }), s = (t - now()) / 1000;
  if (s > -90) return rtf.format(Math.round(s / 60) || 0, 'minute');
  if (s > -5400) return rtf.format(Math.round(s / 60), 'minute');
  if (s > -129600) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
const dateTime = t => new Date(t).toLocaleString(loc(), { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function speedOpts() {
  const s = state.settings, bike = s.mode === 'bike';
  return { normal: (bike ? s.bike : s.walk) / 3.6, min: (bike ? 8 : 3) / 3.6, max: (bike ? 30 : 8) / 3.6, step: (bike ? 0.5 : 0.25) / 3.6, minLeft: s.minLeft };
}

// ---------- GPS (treated as untrustworthy: jamming/spoofing is common) ----------
const gps = { fix: null, ok: false, watch: null };
const inIsrael = p => p.lat > 29.4 && p.lat < 33.4 && p.lng > 34.2 && p.lng < 35.95;
function gpsOn() {
  if (gps.watch != null || !navigator.geolocation) return;
  gps.watch = navigator.geolocation.watchPosition(p => {
    const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp, speed: p.coords.speed };
    const prev = gps.fix;
    const jump = prev && M.haversine(prev, f) / Math.max(1, (f.t - prev.t) / 1000) > 40;
    gps.ok = f.acc <= 60 && inIsrael(f) && !jump;
    gps.fix = f;
  }, () => { gps.ok = false; }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
}
function gpsOff() { if (gps.watch != null) navigator.geolocation.clearWatch(gps.watch); gps.watch = null; gps.ok = false; }
const gpsGood = () => gps.ok && gps.fix && now() - gps.fix.t < 20000;

// ---------- wake lock ----------
let wl = null;
async function wakeLock(on) {
  try {
    if (on && !wl && navigator.wakeLock) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); }
    else if (!on && wl) { await wl.release(); wl = null; }
  } catch { /* not supported / denied: harmless */ }
}

// ---------- UI helpers ----------
const ICON = {
  go: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>',
  light: '<svg viewBox="0 0 24 24"><rect x="7.5" y="2" width="9" height="20" rx="4.5"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="17" r="1.6"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  walk: '<svg viewBox="0 0 24 24"><circle cx="13" cy="4" r="2"/><path d="m9 21 2.5-6.5L14 17v4M7 12l2.5-4 4 .5 2.5 3.5 2 1M11.5 14.5 13 8.5"/></svg>',
  bike: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9 12 16.5h-6.5M14 5h2.5l-1.5 4"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function sheet(title, options) {
  return new Promise(res => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<h3>${esc(title)}</h3>${options.map((o, i) =>
      `<button class="btn ${o.cls || ''}" value="${i}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}
      <button class="btn ghost" value="-1">${T('cancel')}</button>`;
    d.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) { res(+b.value >= 0 ? options[+b.value].value : null); d.close(); }
      else if (e.target === d) d.close();
    });
    d.addEventListener('close', () => { d.remove(); res(null); });
    document.body.append(d);
    d.showModal();
  });
}
const confirmDanger = (q, label) => sheet(q, [{ label, value: true, cls: 'danger' }]);

// Ring: countdown of the current phase. Updated in place by tick().
const ring = (id, cls = '') => `<div class="ring ${cls}" data-ring="${esc(id)}"></div>`;
const CIRC = 2 * Math.PI * 44;
function updRing(el) {
  const l = light(el.dataset.ring);
  if (!l) return;
  const st = M.stateAt(model(l), now());
  const c = st.known ? (st.green ? 'g' : 'r') : 'u';
  const frac = st.known ? Math.max(0, Math.min(1, st.left / st.total)) : 0;
  const txt = st.known ? Math.ceil(st.left) : (l.kind === 'button' ? '⏻' : '?');
  el.dataset.s = c;
  el.dataset.conf = st.conf || '';
  el.innerHTML = `<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44"/>${st.known
    ? `<circle class="arc" cx="50" cy="50" r="44" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC * (1 - frac)}" transform="rotate(-90 50 50)"/>` : ''}</svg><b>${txt}</b>`;
}

function lightSummary(l) {
  const m = model(l), st = M.stateAt(m, now());
  if (st.known) return `${T('cycle')} ${st.C}${T('s')} · ${T('greenFor')} ${Math.round(st.Gd)}${T('s')} · ${T('conf_' + st.conf)}`;
  if (l.kind === 'button' && m.delay != null) return T('btnDelay', Math.round(m.delay));
  return (l.events || []).length ? T('needMore') : T('notMeasured');
}

// ---------- router ----------
const views = {};
let cur = { name: 'go' };
const nav = h => { location.hash = h; };
const back = fallback => history.length > 1 ? history.back() : nav(fallback);
function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  cur = { name: views[name] ? name : 'go', id: rest.join('/') };
  render();
}
function render() {
  const v = views[cur.name];
  document.body.dataset.view = cur.name;
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (v.tab || cur.name)));
  main.innerHTML = v.html ? v.html(cur.id) : '';
  main.scrollTop = 0;
  v.mount?.(cur.id);
  (['map', 'lights', 'run', 'go', 'measure', 'edit', 'place'].includes(cur.name) ? gpsOn : gpsOff)();
  wakeLock(['run', 'measure'].includes(cur.name));
  tick();
}
function tick() {
  document.querySelectorAll('[data-ring]').forEach(updRing);
  views[cur.name].tick?.(cur.id);
}

// ---------- actions (event delegation) ----------
const acts = {};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const [a, ...args] = el.dataset.act.split(':');
  acts[a]?.(...args, el);
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-bind]');
  if (!el) return;
  const [kind, id, field] = el.dataset.bind.split(':');
  const obj = kind === 'settings' ? state.settings : (kind === 'light' ? light : kind === 'place' ? place : routeOf)(id);
  if (!obj) return;
  if (el.type === 'number') { if (el.value === '' || !isFinite(+el.value)) return; obj[field] = +el.value; } else obj[field] = el.value;
  commit();
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const [a, ...args] = el.dataset.change.split(':');
  acts[a]?.(...args, el);
});

acts.nav = (...p) => { p.pop(); nav('#/' + p.join('/')); };
acts.back = (fallback) => back('#/' + fallback);
acts.mode = m => { state.settings.mode = m; commit(); render(); };
acts.lang = l => { state.settings.lang = l; setLang(l); commit(); applyStatic(); render(); };

function addEvent(id, e, quiet) {
  const l = light(id);
  if (!l) return;
  l.events.push({ t: now(), e });
  commit();
  navigator.vibrate?.(35);
  if (!quiet) toast(T('ev_' + e));
  tick();
}
acts.ev = (id, e) => addEvent(id, e);
acts.undo = id => {
  const l = light(id);
  if (!l?.events.length) return;
  l.events.pop();
  commit();
  render();
};

// ================= HOME / PLAN =================
const SLOTS = 40, SLOT = 15e3;
let sel = null;

function pairs() {
  const seen = new Map();
  for (const r of state.routes) if (place(r.from) && place(r.to)) seen.set(r.from + '>' + r.to, [r.from, r.to]);
  return [...seen.values()];
}
function curPair() {
  const ps = pairs();
  if (!ps.length) return null;
  const k = state.ui.pair;
  const found = ps.find(p => p.join('>') === k);
  if (found) return found;
  if (gpsGood()) return ps.reduce((a, b) => M.haversine(gps.fix, place(a[0])) <= M.haversine(gps.fix, place(b[0])) ? a : b);
  return ps[0];
}

views.go = {
  html() {
    const s = state.settings;
    const modeChips = `<div class="seg">${['walk', 'bike'].map(m =>
      `<button class="${s.mode === m ? 'on' : ''}" data-act="mode:${m}">${ICON[m]}<span>${T(m)}</span></button>`).join('')}</div>`;
    if (!state.lights.length && !state.routes.length) return `
      <section class="hero welcome">
        <div class="logo-big">${ICON.light}</div>
        <h1>${T('welcomeTitle')}</h1>
        <p>${T('welcomeText')}</p>
        <ol class="steps"><li>${T('step1')}</li><li>${T('step2')}</li><li>${T('step3')}</li></ol>
        <button class="btn primary big" data-act="nav:map">${T('addFirst')}</button>
        <button class="btn ghost" data-act="nav:settings">${T('importData')}</button>
      </section>`;
    const ps = pairs(), pair = curPair();
    if (!ps.length) return `${modeChips}
      <section class="card"><h2>${T('noRoutesTitle')}</h2><p class="muted">${T('noRoutesText')}</p>
      <button class="btn primary" data-act="newroute">${T('newRoute')}</button></section>
      ${state.places.length < 2 ? `<p class="muted small">${T('needPlaces')}</p><button class="btn" data-act="nav:map">${T('openMap')}</button>` : ''}`;
    const rs = state.routes.filter(r => r.from === pair[0] && r.to === pair[1]);
    return `${modeChips}
      <div class="chips">${ps.map(p => `<button class="chip ${p.join('>') === pair.join('>') ? 'on' : ''}" data-act="pair:${p.join('>')}">${esc(place(p[0]).name)} → ${esc(place(p[1]).name)}</button>`).join('')}</div>
      <section class="hero plan">
        <div class="label">${T('arriveNow')}</div>
        <div class="bignum" id="p-eta">--:--</div>
        <div id="p-sub" class="sub"></div>
        <div id="p-tip" class="tip"></div>
      </section>
      <section class="card">
        <div class="row-between"><h2>${T('whenToLeave')}</h2><span class="muted small">${T('next10')}</span></div>
        <div class="heat">${rs.map(r => `
          <div class="hrow"><div class="hname">${esc(r.name)}</div>
          <div class="cells">${Array.from({ length: SLOTS }, (_, k) => `<i id="c-${r.id}-${k}" data-act="cell:${r.id}:${k}" class="${k % 4 === 0 ? 'm' : ''}"></i>`).join('')}</div></div>`).join('')}
          <div class="axis">${[0, 2, 4, 6, 8].map(m => `<span>${m ? '+' + m : T('now')}</span>`).join('')}</div>
        </div>
        <div class="legend"><span><i style="background:var(--heat0)"></i>${T('noWait')}</span><span><i style="background:var(--heat1)"></i>${T('longWait')}</span></div>
        <p id="p-sel" class="sel muted">${T('tapCell')}</p>
      </section>
      ${rs.map(r => `
      <section class="card route">
        <div class="row-between"><div><h3>${esc(r.name)}</h3><div class="muted small" id="r-info-${r.id}"></div></div>
          <button class="btn primary" data-act="start:${r.id}">${T('start')}</button></div>
        <div class="dots" id="r-dots-${r.id}"></div>
        <button class="link small" data-act="nav:route:${r.id}">${T('editRoute')}</button>
      </section>`).join('')}
      <button class="btn ghost wide" data-act="newroute">${ICON.plus} ${T('newRoute')}</button>`;
  },
  tick() {
    const pair = curPair(), eta = $('#p-eta');
    if (!pair || !eta) return;
    const rs = state.routes.filter(r => r.from === pair[0] && r.to === pair[1]);
    const ms = models(), sp = speedOpts(), t0 = Math.floor(now() / 1000) * 1000, by = byId();
    const rows = rs.map(r => {
      const legs = M.routeLegs(r, by);
      return legs && { r, sims: Array.from({ length: SLOTS }, (_, k) => M.simulate(legs, t0 + k * SLOT, sp.normal, ms, sp.minLeft)) };
    }).filter(Boolean);
    if (!rows.length) { eta.textContent = '--:--'; return; }
    const etaAt = k => Math.min(...rows.map(x => x.sims[k].eta));
    const best0 = etaAt(0);
    let kLate = 0;
    for (let k = 0; k < SLOTS; k++) if (etaAt(k) <= best0 + 15e3) kLate = k;
    const bestRow = rows.reduce((a, b) => a.sims[0].eta <= b.sims[0].eta ? a : b);
    eta.textContent = hms(best0);
    $('#p-sub').textContent = T('viaWait', bestRow.r.name, dur(bestRow.sims[0].wait));
    $('#p-tip').textContent = kLate ? T('canLeaveLater', dur(kLate * SLOT)) : (bestRow.sims[0].wait > 20e3 ? T('leaveNowAnyway') : T('leaveNow'));
    for (const x of rows) {
      x.sims.forEach((s, k) => {
        const c = $(`#c-${x.r.id}-${k}`);
        if (!c) return;
        c.style.setProperty('--w', Math.min(1, s.wait / 90e3).toFixed(2));
        c.classList.toggle('sel', sel?.r === x.r.id && sel?.k === k);
        c.classList.toggle('unk', s.unknown > 0);
      });
      const s0 = x.sims[0];
      $(`#r-info-${x.r.id}`).textContent = `${T('arrive')} ${hms(s0.eta)} · ${T('waiting')} ${dur(s0.wait)}${s0.unknown ? ' · ' + T('unknownN', s0.unknown) : ''}`;
      $(`#r-dots-${x.r.id}`).innerHTML = s0.at.map(a => `<span class="dot ${!a.known ? 'u' : a.cross - a.arrive < 1500 ? 'g' : 'r'}" title="${esc(light(a.light)?.name)}"></span>`).join('<i></i>');
    }
    if (sel) {
      const x = rows.find(x => x.r.id === sel.r), s = x?.sims[sel.k];
      if (s) $('#p-sel').textContent = T('selDetail', hms(t0 + sel.k * SLOT), x.r.name, hms(s.eta), dur(s.wait));
    }
  },
};
acts.pair = k => { state.ui.pair = k; sel = null; save(); render(); };
acts.cell = (r, k) => { sel = { r, k: +k }; tick(); };
acts.newroute = () => {
  const pair = curPair();
  const r = { id: uid(), name: T('routeN', state.routes.length + 1), from: pair?.[0] || state.places[0]?.id || null, to: pair?.[1] || state.places[1]?.id || null, via: [] };
  state.routes.push(r);
  commit();
  nav('#/route/' + r.id);
};
acts.start = id => {
  state.ui.run = { route: id, seg: 0, segStart: now(), at: false, near: false, started: now() };
  save();
  nav('#/run/' + id);
};

// ================= GO MODE =================
views.run = {
  tab: 'go',
  html(id) {
    const r = routeOf(id), legs = r && M.routeLegs(r, byId()), run = state.ui.run;
    if (!legs || !run || run.route !== id) return `<p class="card">${T('noRun')}</p>`;
    const leg = legs[run.seg], l = leg.light && light(leg.light);
    return `
      <div class="runhead"><div><div class="muted small">${esc(r.name)}</div>
        <div class="muted small">${l ? T('lightXofY', run.seg + 1, r.via.length) : T('lastLeg')}</div></div>
        <div class="eta"><div class="muted small">${T('arrive')}</div><b id="g-eta">--:--</b></div></div>
      <div class="dots big" id="g-dots"></div>
      <section class="hero run">
        ${l ? `<div class="target"><h2>${esc(l.name)}</h2><span id="g-gps" class="gpschip"></span></div>
          ${ring(l.id, 'xl')}
          <div class="dist" id="g-dist"></div>` : `<h2>${esc(place(r.to)?.name)}</h2><div class="dist" id="g-dist"></div>`}
        <div class="advice" id="g-adv"></div>
      </section>
      ${l ? `
        <div class="grid2">
          <button class="btn" data-act="at">${T('imHere')}</button>
          <button class="btn primary" data-act="advance">${T('crossed')}</button>
        </div>
        <div class="report"><span class="muted small">${T('reportNow')}</span>
          <button class="btn g" data-act="ev:${l.id}:G">${T('greenNow')}</button>
          <button class="btn r" data-act="ev:${l.id}:R">${T('redNow')}</button>
          ${l.kind === 'button' ? `<button class="btn" data-act="ev:${l.id}:P">${T('pressed')}</button>` : ''}
        </div>` : `<button class="btn primary wide" data-act="advance">${T('finish')}</button>`}
      <button class="link small center" data-act="endrun">${T('endRun')}</button>
      <p class="muted tiny center">${T('safety')}</p>`;
  },
  tick(id) {
    const r = routeOf(id), run = state.ui.run, legs = r && M.routeLegs(r, byId());
    if (!legs || !run || run.route !== id || !$('#g-adv')) return;
    const leg = legs[run.seg], sp = speedOpts(), ms = models(), t = now();
    const good = gpsGood();
    let d;
    if (run.at) d = 0;
    else if (good) {
      const raw = M.haversine(gps.fix, leg.to);
      d = raw * 1.1; // shortcut: near the target the street path is almost straight
      if (gps.fix.acc < 25) {
        if (raw < 20) run.near = true;
        else if (run.near && raw > 30) return acts.advance();
      }
    } else d = Math.max(0, leg.dist - (t - run.segStart) / 1000 * sp.normal);
    const gchip = $('#g-gps');
    if (gchip) { gchip.textContent = good ? T('gpsOk') : T('gpsOff'); gchip.dataset.ok = good; }
    $('#g-dist').textContent = d < 8 ? T('atLight') : `${good ? '' : '~'}${meters(d)}`;
    const rest = legs.slice(run.seg), adv = $('#g-adv');
    if (!leg.light) {
      $('#g-eta').textContent = hms(t + d / sp.normal * 1000);
      adv.innerHTML = `<div class="pace">${T('almost')}</div>`;
      return;
    }
    const p = M.pace(d, rest, t, ms, sp);
    $('#g-eta').textContent = hms(p.rec.eta);
    // upcoming lights, coloured by what happens at the recommended pace
    const sim = M.simulate(rest.slice(1), p.rec.cross, sp.normal, ms, sp.minLeft);
    const done = legs.slice(0, run.seg).filter(x => x.light).length;
    $('#g-dots').innerHTML = [...Array(done).fill('<span class="dot done"></span>'),
      `<span class="dot cur ${p.rec.wait0 < 1500 ? 'g' : 'r'}"></span>`,
      ...sim.at.map(a => `<span class="dot ${!a.known ? 'u' : a.cross - a.arrive < 1500 ? 'g' : 'r'}"></span>`)].join('<i></i>');
    const m = ms[leg.light];
    const st = M.stateAt(m, t);
    if (!st.known && !(m.kind === 'button' && m.delay != null)) {
      adv.innerHTML = `<div class="pace small">${T('noData')}</div><button class="btn" data-act="nav:measure:${leg.light}">${T('measureNow')}</button>`;
      return;
    }
    if (d < 8) {
      const c = M.crossAt(m, t, sp.minLeft);
      adv.innerHTML = c.t <= t
        ? `<div class="pace go">${T('goNow')}</div><div class="sub">${T('secLeft', Math.floor(st.left))}</div>`
        : `<div class="pace wait">${T('waitFor', dur(c.t - t))}</div><div class="sub">${m.kind === 'button' && !st.known ? T('pressBtn') : T('greenAt', hms(c.t))}</div>`;
      return;
    }
    const diff = p.rec.s - sp.normal;
    const mood = diff > 0.1 ? 'hurry' : diff < -0.1 ? 'easy' : 'keep';
    const lost = p.normal.eta - p.best;
    const you = good && gps.fix.speed != null ? `<div class="you">${T('yourSpeed', kmh(gps.fix.speed))}</div>` : '';
    adv.innerHTML = `
      <div class="label">${T('mood_' + mood)}</div>
      <div class="pace ${mood}">${kmh(p.rec.s)} <small>${T('kmh')}</small></div>
      <div class="sub">${p.rec.wait0 < 1500 ? T('arriveGreen') : T('waitThere', dur(p.rec.wait0))}</div>
      ${lost > 3000 ? `<div class="sub warn">${T('normalLoses', kmh(sp.normal), dur(lost))}</div>` : ''}${you}`;
  },
};
acts.at = () => { state.ui.run.at = true; save(); tick(); };
acts.advance = () => {
  const run = state.ui.run, r = routeOf(run?.route), legs = r && M.routeLegs(r, byId());
  if (!legs) return nav('#/go');
  Object.assign(run, { seg: run.seg + 1, segStart: now(), at: false, near: false });
  if (run.seg >= legs.length) {
    toast(T('arrived', dur(now() - run.started)));
    state.ui.run = null;
    save();
    return nav('#/go');
  }
  save();
  render();
};
acts.endrun = () => { state.ui.run = null; save(); nav('#/go'); };

// ================= MAP =================
let map, markerLayer, meDot;
function ensureMap() {
  if (map) return;
  const v = state.ui.view || { lat: 32.0853, lng: 34.7818, z: 15 };
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([v.lat, v.lng], v.z);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: true, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  map.attributionControl.setPrefix('Leaflet');
  markerLayer = L.layerGroup().addTo(map);
  map.on('moveend', () => { const c = map.getCenter(); state.ui.view = { lat: c.lat, lng: c.lng, z: map.getZoom() }; save(); });
}
function drawMarkers() {
  markerLayer.clearLayers();
  const by = byId();
  for (const r of state.routes) {
    const pts = [r.from, ...r.via, r.to].map(id => by[id]).filter(p => p?.lat != null);
    if (pts.length > 1) L.polyline(pts.map(p => [p.lat, p.lng]), { color: '#2f6bff', weight: 4, opacity: 0.35, interactive: false }).addTo(markerLayer);
  }
  for (const p of state.places) L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className: '', html: `<div class="pinmk">${ICON.pin}<span>${esc(p.name)}</span></div>`, iconSize: [0, 0] }),
  }).on('click', () => nav('#/place/' + p.id)).addTo(markerLayer);
  for (const l of state.lights) L.marker([l.lat, l.lng], {
    icon: L.divIcon({ className: '', html: `<div class="lightmk">${ring(l.id, 'sm')}<span>${esc(l.name)}</span></div>`, iconSize: [0, 0] }),
  }).on('click', () => nav('#/light/' + l.id)).addTo(markerLayer);
}
let pick = null; // {kind, id}
views.map = {
  mount() {
    ensureMap();
    setTimeout(() => map.invalidateSize(), 0);
    drawMarkers();
    $('#mapwrap').classList.toggle('picking', !!pick);
    if (pick) {
      const o = pick.kind === 'light' ? light(pick.id) : place(pick.id);
      if (o?.lat != null) map.setView([o.lat, o.lng], Math.max(map.getZoom(), 17));
    }
  },
  tick() {
    if (!map) return;
    if (gpsGood()) {
      if (!meDot) meDot = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 3, fillColor: '#2f6bff', fillOpacity: 1 }).addTo(map);
      meDot.setLatLng([gps.fix.lat, gps.fix.lng]);
    } else if (meDot) { meDot.remove(); meDot = null; }
  },
};
acts.locate = () => {
  if (gpsGood()) map.setView([gps.fix.lat, gps.fix.lng], 18);
  else toast(T('gpsBad'));
};
acts.mapadd = async () => {
  const kind = await sheet(T('addWhat'), [{ label: T('addLightHere'), value: 'light', cls: 'primary' }, { label: T('addPlaceHere'), value: 'place' }]);
  if (!kind) return;
  const c = map.getCenter();
  createAt(kind, c.lat, c.lng);
};
function createAt(kind, lat, lng) {
  if (kind === 'light') {
    const l = { id: uid(), name: T('lightN', state.lights.length + 1), lat, lng, kind: 'fixed', notes: '', photos: [], events: [] };
    state.lights.push(l);
    commit();
    nav('#/edit/' + l.id);
  } else {
    const p = { id: uid(), name: state.places.length ? T('placeN', state.places.length + 1) : T('home'), lat, lng };
    state.places.push(p);
    commit();
    nav('#/place/' + p.id);
  }
}
acts.pickset = () => {
  const o = pick && (pick.kind === 'light' ? light(pick.id) : place(pick.id)), c = map.getCenter();
  if (o) { o.lat = c.lat; o.lng = c.lng; commit(); }
  const back = pick ? `#/${pick.kind === 'light' ? 'edit' : 'place'}/${pick.id}` : '#/map';
  pick = null;
  $('#mapwrap').classList.remove('picking');
  nav(back);
};
acts.pickcancel = () => { const p = pick; pick = null; $('#mapwrap').classList.remove('picking'); nav(p ? `#/${p.kind === 'light' ? 'edit' : 'place'}/${p.id}` : '#/map'); };
acts.pickon = (kind, id) => { pick = { kind, id }; nav('#/map'); };
acts.usegps = (kind, id) => {
  if (!gpsGood()) return toast(T('gpsBad'));
  const o = kind === 'light' ? light(id) : place(id);
  o.lat = gps.fix.lat; o.lng = gps.fix.lng;
  commit();
  toast(T('locSet'));
  render();
};

// ================= LIGHTS LIST =================
views.lights = {
  html() {
    const good = gpsGood();
    const last = l => l.events.at(-1)?.t || 0;
    const ls = [...state.lights].sort(good ? (a, b) => M.haversine(gps.fix, a) - M.haversine(gps.fix, b) : (a, b) => last(b) - last(a));
    return `
      <div class="row-between"><h1>${T('lights')}</h1><button class="btn primary" data-act="addlight">${ICON.plus} ${T('add')}</button></div>
      ${ls.length ? '' : `<p class="muted">${T('noLights')}</p>`}
      <ul class="list">${ls.map(l => `
        <li data-act="nav:light:${l.id}">${ring(l.id, 'sm')}
          <div class="grow"><b>${esc(l.name)}</b>${l.kind === 'button' ? ` <span class="badge">${T('kind_button')}</span>` : ''}
          <div class="muted small" data-sum="${l.id}">${lightSummary(l)}</div></div>
          ${good ? `<span class="muted small">${meters(M.haversine(gps.fix, l))}</span>` : ''}</li>`).join('')}</ul>
      <div class="row-between"><h2>${T('places')}</h2><button class="btn" data-act="addplace">${ICON.plus} ${T('add')}</button></div>
      ${state.places.length ? `<ul class="list">${state.places.map(p => `<li data-act="nav:place:${p.id}"><span class="pinicon">${ICON.pin}</span><div class="grow"><b>${esc(p.name)}</b></div></li>`).join('')}</ul>` : `<p class="muted small">${T('noPlaces')}</p>`}`;
  },
  tick() {
    for (const el of document.querySelectorAll('[data-sum]')) { const l = light(el.dataset.sum); if (l) el.textContent = lightSummary(l); }
  },
};
async function addHere(kind) {
  const how = await sheet(T(kind === 'light' ? 'addLight' : 'addPlace'), [
    { label: T('atMyGps'), value: 'gps', disabled: !gpsGood(), cls: 'primary' },
    { label: T('onMap'), value: 'map' },
  ]);
  if (how === 'gps') createAt(kind, gps.fix.lat, gps.fix.lng);
  else if (how === 'map') { nav('#/map'); setTimeout(() => toast(T('panThenPlus')), 300); }
}
acts.addlight = () => addHere('light');
acts.addplace = () => addHere('place');

// ================= LIGHT DETAIL =================
views.light = {
  tab: 'lights',
  html(id) {
    const l = light(id);
    if (!l) return `<p>${T('notFound')}</p>`;
    const m = model(l);
    const repeat = m.repeat === true ? T('repeatYes') : m.repeat === false ? T('repeatNo') : T('repeatUnknown');
    const sess = [...m.sessions].reverse();
    return `
      <div class="row-between"><button class="link" data-act="back:lights">${T('back')}</button><button class="link" data-act="nav:edit:${l.id}">${T('edit')}</button></div>
      <section class="hero">
        <h1>${esc(l.name)}</h1>${l.kind === 'button' ? `<span class="badge">${T('kind_button')}</span>` : ''}
        ${ring(l.id, 'xl')}
        <div class="sub" data-sum="${l.id}">${lightSummary(l)}</div>
        <button class="btn primary big" data-act="nav:measure:${l.id}">${T('measure')}</button>
      </section>
      ${m.C ? `<section class="card stats">
        <div><b>${m.C}${T('s')}</b><span>${T('cycle')}</span></div>
        <div><b>${m.Gd != null ? Math.round(m.Gd) + T('s') : '–'}</b><span>${T('greenFor')}</span></div>
        <div><b>${m.Gd != null ? Math.round(m.C - m.Gd) + T('s') : '–'}</b><span>${T('redFor')}</span></div>
        <p class="muted small full">${repeat}</p></section>` : ''}
      ${l.kind === 'button' ? `<section class="card"><h3>${T('btnTitle')}</h3><p class="muted small">${m.delay != null ? T('btnStats', Math.round(m.delay), Math.round(m.delayMax), m.nDelays) : T('btnHow')}</p></section>` : ''}
      ${l.photos.length ? `<section class="photos">${l.photos.map(p => `<img src="${photos[p] || ''}" alt="" data-act="photo:${l.id}:${p}">`).join('')}</section>` : ''}
      ${l.notes ? `<section class="card"><p class="notes">${esc(l.notes)}</p></section>` : ''}
      <section class="card"><h3>${T('visits')}</h3>
        ${sess.length ? `<ul class="list plain">${sess.map(s => `<li><div class="grow">${dateTime(s.start)}<div class="muted small">${s.C ? `${T('cycle')} ${s.C}${T('s')}` : ''}${s.Gd != null ? ` · ${T('greenFor')} ${Math.round(s.Gd)}${T('s')}` : ''} · ${T('taps', s.n)}</div></div>
          <button class="icon" aria-label="${T('delete')}" data-act="delsess:${l.id}:${s.start}:${s.end}">${ICON.x}</button></li>`).join('')}</ul>` : `<p class="muted small">${T('noVisits')}</p>`}
      </section>`;
  },
};
acts.delsess = async (id, a, b) => {
  if (!await confirmDanger(T('delVisitQ'), T('delete'))) return;
  const l = light(id);
  l.events = l.events.filter(e => e.t < +a || e.t > +b);
  commit();
  render();
};

// ================= MEASURE =================
views.measure = {
  tab: 'lights',
  html(id) {
    const l = light(id);
    if (!l) return `<p>${T('notFound')}</p>`;
    return `
      <div class="row-between"><button class="link" data-act="back:light/${l.id}">${T('done')}</button><b>${esc(l.name)}</b></div>
      <section class="hero measure">
        ${ring(l.id, 'xl')}
        <div class="sub" id="m-sum"></div>
        <p class="muted small">${T(l.kind === 'button' ? 'measureHintBtn' : 'measureHint')}</p>
      </section>
      <div class="tapgrid">
        <button class="tap g" data-act="ev:${l.id}:G">${T('turnedGreen')}</button>
        <button class="tap r" data-act="ev:${l.id}:R">${T('turnedRed')}</button>
        ${l.kind === 'button' ? `<button class="tap p" data-act="ev:${l.id}:P">${T('pressed')}</button>` : ''}
      </div>
      <section class="card"><div class="row-between"><h3>${T('thisVisit')}</h3><button class="link" data-act="undo:${l.id}">${T('undo')}</button></div>
        <ul class="taplog" id="m-log"></ul></section>`;
  },
  tick(id) {
    const l = light(id), log = $('#m-log');
    if (!l || !log) return;
    const m = model(l), s = m.sessions.at(-1);
    $('#m-sum').textContent = s && now() - s.end < 5 * 60e3
      ? [s.C ? `${T('cycle')} ${s.C}${T('s')}` : T('needCycle'), s.Gd != null ? `${T('greenFor')} ${Math.round(s.Gd)}${T('s')}` : T('needGreen')].join(' · ')
      : T('startTapping');
    const recent = l.events.filter(e => now() - e.t < 15 * 60e3).slice(-8).reverse();
    const html = recent.map((e, i) => {
      const prev = recent[i + 1];
      return `<li><span class="dot ${e.e === 'G' ? 'g' : e.e === 'R' ? 'r' : 'u'}"></span>${T('ev_' + e.e)}<span class="muted">${hms(e.t)}${prev ? ` (+${Math.round((e.t - prev.t) / 1000)}${T('s')})` : ''}</span></li>`;
    }).join('');
    if (log.innerHTML !== html) log.innerHTML = html;
  },
};

// ================= EDIT LIGHT =================
views.edit = {
  tab: 'lights',
  html(id) {
    const l = light(id);
    if (!l) return `<p>${T('notFound')}</p>`;
    return `
      <div class="row-between"><h1>${T('editLight')}</h1><button class="btn primary" data-act="nav:light:${l.id}">${T('done')}</button></div>
      <label class="field"><span>${T('name')}</span><input data-bind="light:${l.id}:name" value="${esc(l.name)}" maxlength="80" placeholder="${T('namePh')}"></label>
      <div class="field"><span>${T('kind')}</span>
        <div class="seg">${['fixed', 'button'].map(k => `<button class="${l.kind === k ? 'on' : ''}" data-act="kind:${l.id}:${k}">${T('kind_' + k)}</button>`).join('')}</div>
        <p class="muted small">${T('kindHelp_' + l.kind)}</p></div>
      <div class="field"><span>${T('location')}</span>
        <div class="grid2"><button class="btn" data-act="pickon:light:${l.id}">${T('setOnMap')}</button><button class="btn" data-act="usegps:light:${l.id}">${T('useGps')}</button></div></div>
      <div class="field"><span>${T('photos')}</span>
        <div class="photos">${l.photos.map(p => `<img src="${photos[p] || ''}" alt="" data-act="photo:${l.id}:${p}">`).join('')}
          <label class="addphoto">${ICON.camera}<input type="file" accept="image/*" capture="environment" data-change="addphoto:${l.id}" hidden></label></div>
        <p class="muted small">${T('photoHelp')}</p></div>
      <label class="field"><span>${T('notes')}</span><textarea data-bind="light:${l.id}:notes" rows="3" maxlength="2000" placeholder="${T('notesPh')}">${esc(l.notes)}</textarea></label>
      <button class="btn danger wide" data-act="dellight:${l.id}">${T('deleteLight')}</button>`;
  },
};
acts.kind = (id, k) => { light(id).kind = k; commit(); render(); };
acts.dellight = async id => {
  if (!await confirmDanger(T('delLightQ'), T('delete'))) return;
  const l = light(id);
  for (const p of l.photos) S.del('photos', p).catch(() => {});
  state.lights = state.lights.filter(x => x !== l);
  state.routes.forEach(r => { r.via = r.via.filter(v => v !== id); });
  commit();
  nav('#/lights');
};
async function compress(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}
acts.addphoto = async (id, input) => {
  const f = input.files?.[0];
  if (!f) return;
  try {
    const data = await compress(f), pid = uid();
    await S.put('photos', pid, data);
    photos[pid] = data;
    light(id).photos.push(pid);
    commit();
    render();
  } catch (e) { console.error(e); toast(T('photoFailed')); }
};
acts.photo = async (id, pid) => {
  const d = document.createElement('dialog');
  d.className = 'viewer';
  d.innerHTML = `<img src="${photos[pid]}" alt=""><div class="grid2"><button class="btn danger" value="del">${T('delete')}</button><button class="btn" value="close">${T('close')}</button></div>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', async e => {
    const v = e.target.closest('button')?.value;
    if (v === 'close' || e.target === d) d.close();
    if (v === 'del') {
      d.close();
      const l = light(id);
      l.photos = l.photos.filter(p => p !== pid);
      delete photos[pid];
      S.del('photos', pid).catch(() => {});
      commit();
      render();
    }
  });
  d.showModal();
};

// ================= PLACE =================
views.place = {
  tab: 'lights',
  html(id) {
    const p = place(id);
    if (!p) return `<p>${T('notFound')}</p>`;
    return `
      <div class="row-between"><h1>${T('place')}</h1><button class="btn primary" data-act="back:lights">${T('done')}</button></div>
      <label class="field"><span>${T('name')}</span><input data-bind="place:${p.id}:name" value="${esc(p.name)}" maxlength="60" placeholder="${T('placePh')}"></label>
      <div class="field"><span>${T('location')}</span>
        <div class="grid2"><button class="btn" data-act="pickon:place:${p.id}">${T('setOnMap')}</button><button class="btn" data-act="usegps:place:${p.id}">${T('useGps')}</button></div></div>
      <button class="btn danger wide" data-act="delplace:${p.id}">${T('deletePlace')}</button>`;
  },
};
acts.delplace = async id => {
  const used = state.routes.filter(r => r.from === id || r.to === id);
  if (!await confirmDanger(used.length ? T('delPlaceRoutesQ', used.length) : T('delPlaceQ'), T('delete'))) return;
  state.places = state.places.filter(p => p.id !== id);
  state.routes = state.routes.filter(r => !used.includes(r));
  commit();
  nav('#/lights');
};

// ================= ROUTE EDITOR =================
views.route = {
  tab: 'go',
  html(id) {
    const r = routeOf(id);
    if (!r) return `<p>${T('notFound')}</p>`;
    const by = byId(), from = place(r.from), to = place(r.to);
    const detour = l => from && to ? M.haversine(from, l) + M.haversine(l, to) - M.haversine(from, to) : 0;
    const others = state.lights.filter(l => !r.via.includes(l.id)).sort((a, b) => detour(a) - detour(b));
    const legs = M.routeLegs(r, by);
    const total = legs ? legs.reduce((s, x) => s + x.dist, 0) : 0;
    const placeSel = (field) => `<select data-change="routeplace:${r.id}:${field}">${state.places.map(p => `<option value="${p.id}" ${r[field] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
    return `
      <div class="row-between"><h1>${T('route')}</h1><button class="btn primary" data-act="nav:go">${T('done')}</button></div>
      <label class="field"><span>${T('name')}</span><input data-bind="route:${r.id}:name" value="${esc(r.name)}" maxlength="60" placeholder="${T('routePh')}"></label>
      ${state.places.length < 2 ? `<p class="card muted">${T('needPlaces')}</p>` : `
      <div class="grid2"><label class="field"><span>${T('from')}</span>${placeSel('from')}</label><label class="field"><span>${T('to')}</span>${placeSel('to')}</label></div>`}
      <div class="field"><span>${T('lightsInOrder')}</span>
        <ol class="list plain order">${r.via.map((v, i) => `<li><b class="num">${i + 1}</b><div class="grow">${esc(by[v]?.name)}</div>
          <button class="icon" aria-label="${T('up')}" data-act="mv:${r.id}:${i}:-1" ${i ? '' : 'disabled'}>${ICON.up}</button>
          <button class="icon" aria-label="${T('down')}" data-act="mv:${r.id}:${i}:1" ${i < r.via.length - 1 ? '' : 'disabled'}>${ICON.down}</button>
          <button class="icon" aria-label="${T('remove')}" data-act="rmvia:${r.id}:${i}">${ICON.x}</button></li>`).join('') || `<p class="muted small">${T('noVia')}</p>`}</ol>
        ${legs ? `<p class="muted small">${T('routeLen', meters(total), dur(total / speedOpts().normal * 1000))}</p>` : ''}</div>
      ${others.length ? `<div class="field"><span>${T('addLights')}</span><ul class="list plain">${others.map(l => `
        <li data-act="addvia:${r.id}:${l.id}">${ring(l.id, 'sm')}<div class="grow">${esc(l.name)}</div><span class="addbtn">${ICON.plus}</span></li>`).join('')}</ul></div>` : ''}
      <div class="grid2"><button class="btn" data-act="reverse:${r.id}">${T('reverseCopy')}</button><button class="btn danger" data-act="delroute:${r.id}">${T('deleteRoute')}</button></div>`;
  },
};
acts.routeplace = (id, field, el) => { routeOf(id)[field] = el.value; commit(); render(); };
acts.mv = (id, i, d) => { const v = routeOf(id).via; i = +i; [v[i], v[i + +d]] = [v[i + +d], v[i]]; commit(); render(); };
acts.rmvia = (id, i) => { routeOf(id).via.splice(+i, 1); commit(); render(); };
acts.addvia = (id, lid) => {
  // cheapest insertion: put the light where it lengthens the path least
  const r = routeOf(id), by = byId(), l = light(lid);
  const pts = [by[r.from], ...r.via.map(v => by[v]), by[r.to]];
  let best = r.via.length, bestCost = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    if (!pts[i] || !pts[i + 1]) continue;
    const c = M.haversine(pts[i], l) + M.haversine(l, pts[i + 1]) - M.haversine(pts[i], pts[i + 1]);
    if (c < bestCost) { bestCost = c; best = i; }
  }
  r.via.splice(best, 0, lid);
  commit();
  render();
};
acts.reverse = id => {
  const r = routeOf(id), n = { id: uid(), name: `${r.name} ↩`, from: r.to, to: r.from, via: [...r.via].reverse() };
  state.routes.push(n);
  commit();
  nav('#/route/' + n.id);
};
acts.delroute = async id => {
  if (!await confirmDanger(T('delRouteQ'), T('delete'))) return;
  state.routes = state.routes.filter(r => r.id !== id);
  commit();
  nav('#/go');
};

// ================= SETTINGS =================
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (cur.name === 'settings') render(); });
views.settings = {
  tab: 'go',
  html() {
    const s = state.settings;
    return `
      <div class="row-between"><h1>${T('settings')}</h1><button class="btn primary" data-act="back:go">${T('done')}</button></div>
      ${installEvt ? `<button class="btn primary wide" data-act="install">${T('install')}</button>` : ''}
      <div class="field"><span>${T('language')}</span><div class="seg">
        <button class="${getLang() === 'he' ? 'on' : ''}" data-act="lang:he">עברית</button><button class="${getLang() === 'en' ? 'on' : ''}" data-act="lang:en">English</button></div></div>
      <div class="grid2">
        <label class="field"><span>${T('walkSpeed')}</span><input type="number" inputmode="decimal" min="2" max="9" step="0.1" data-bind="settings::walk" value="${s.walk}"></label>
        <label class="field"><span>${T('bikeSpeed')}</span><input type="number" inputmode="decimal" min="6" max="35" step="0.5" data-bind="settings::bike" value="${s.bike}"></label>
      </div>
      <label class="field"><span>${T('minLeft')}</span><input type="number" inputmode="numeric" min="0" max="20" step="1" data-bind="settings::minLeft" value="${s.minLeft}">
        <small class="muted">${T('minLeftHelp')}</small></label>
      <section class="card"><h3>${T('data')}</h3><p class="muted small">${T('dataHelp')}</p>
        <div class="grid2"><button class="btn" data-act="export">${T('export')}</button>
        <label class="btn">${T('import')}<input type="file" accept=".json,application/json" data-change="import" hidden></label></div>
        ${navigator.canShare ? `<button class="btn wide" data-act="export:share">${T('share')}</button>` : ''}
        <button class="btn danger wide" data-act="wipe">${T('wipe')}</button></section>
      <section class="card"><h3>${T('privacy')}</h3><p class="muted small">${T('privacyText')}</p></section>
      <section class="card"><h3>${T('howTitle')}</h3><p class="muted small">${T('howText')}</p></section>
      <p class="muted tiny center">${T('safety')}</p>
      <p class="muted tiny center">Nickotime · v1 · Map data © OpenStreetMap contributors</p>`;
  },
};
acts.install = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); };
acts.export = async mode => {
  const ph = await S.getAll('photos');
  const { ui, ...rest } = state;
  const name = `nickotime-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify({ app: 'nickotime', v: 1, exported: new Date().toISOString(), state: rest, photos: ph })], name, { type: 'application/json' });
  if (mode === 'share' && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Nickotime' }); } catch { /* user cancelled */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// Imported files come from other people: validate every field.
function cleanImport(data) {
  const s = data?.state;
  if (data?.app !== 'nickotime' || !s || typeof s !== 'object') throw new Error('format');
  const num = x => typeof x === 'number' && isFinite(x);
  const str = (x, n = 200) => typeof x === 'string' ? x.slice(0, n) : '';
  const arr = x => Array.isArray(x) ? x : [];
  const pt = p => str(p?.id) && num(p.lat) && num(p.lng);
  return {
    lights: arr(s.lights).filter(pt).map(l => ({
      id: str(l.id), name: str(l.name, 80), lat: l.lat, lng: l.lng, kind: l.kind === 'button' ? 'button' : 'fixed', notes: str(l.notes, 2000),
      photos: arr(l.photos).filter(p => typeof p === 'string').map(p => p.slice(0, 40)),
      events: arr(l.events).filter(e => num(e?.t) && ['G', 'R', 'P'].includes(e.e)).map(e => ({ t: e.t, e: e.e })),
    })),
    places: arr(s.places).filter(pt).map(p => ({ id: str(p.id), name: str(p.name, 60), lat: p.lat, lng: p.lng })),
    routes: arr(s.routes).filter(r => str(r?.id)).map(r => ({ id: str(r.id), name: str(r.name, 60), from: str(r.from), to: str(r.to), via: arr(r.via).filter(v => typeof v === 'string').map(v => v.slice(0, 40)) })),
    photos: Object.fromEntries(Object.entries(data.photos && typeof data.photos === 'object' ? data.photos : {})
      .filter(([k, v]) => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v) && k.length <= 40)),
  };
}
acts.import = async (input) => {
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  let d;
  try { d = cleanImport(JSON.parse(await f.text())); } catch { return toast(T('importBad')); }
  let nl = 0, ne = 0;
  for (const l of d.lights) {
    const ex = light(l.id);
    if (!ex) { state.lights.push(l); nl++; ne += l.events.length; continue; }
    const keys = new Set(ex.events.map(e => e.t + e.e));
    for (const e of l.events) if (!keys.has(e.t + e.e)) { ex.events.push(e); ne++; }
    ex.events.sort((a, b) => a.t - b.t);
    for (const p of l.photos) if (!ex.photos.includes(p)) ex.photos.push(p);
  }
  for (const p of d.places) if (!place(p.id)) state.places.push(p);
  for (const r of d.routes) if (!routeOf(r.id)) state.routes.push(r);
  for (const [k, v] of Object.entries(d.photos)) { if (!photos[k]) { await S.put('photos', k, v); photos[k] = v; } }
  commit();
  toast(T('imported', nl, ne));
  render();
};
acts.wipe = async () => {
  if (!await confirmDanger(T('wipeQ'), T('wipe'))) return;
  const lang = state.settings.lang;
  await S.clear('photos');
  photos = {};
  state = DEFAULT();
  state.settings.lang = lang;
  commit();
  nav('#/go');
};

// ---------- boot ----------
function applyStatic() {
  const he = getLang() === 'he';
  document.documentElement.lang = he ? 'he' : 'en';
  document.documentElement.dir = he ? 'rtl' : 'ltr';
  $('#settings-btn').innerHTML = ICON.gear;
  $('#settings-btn').setAttribute('aria-label', T('settings'));
  $('#brand').innerHTML = `${ICON.light}<span>Nickotime</span>`;
  $('#tabs').innerHTML = [['go', ICON.go, T('tabGo')], ['map', ICON.map, T('tabMap')], ['lights', ICON.light, T('tabLights')]]
    .map(([k, i, label]) => `<a href="#/${k}" data-tab="${k}">${i}<span>${label}</span></a>`).join('');
  $('#mapfabs').innerHTML = `<button class="fab" data-act="locate" aria-label="${T('locate')}">${ICON.locate}</button><button class="fab primary" data-act="mapadd" aria-label="${T('add')}">${ICON.plus}</button>`;
  $('#pickbar').innerHTML = `<p>${T('pickHint')}</p><div class="grid2"><button class="btn" data-act="pickcancel">${T('cancel')}</button><button class="btn primary" data-act="pickset">${T('setHere')}</button></div>`;
}

async function boot() {
  try {
    state = Object.assign(DEFAULT(), await S.get('kv', 'state'));
    photos = await S.getAll('photos'); // shortcut: all photos in memory; lazy-load if libraries grow past ~100 photos
  } catch (e) {
    console.error(e);
    state = DEFAULT();
    toast(T('storageFailed'));
  }
  state.settings = { ...DEFAULT().settings, ...state.settings };
  setLang(state.settings.lang || (/^en/i.test(navigator.language) ? 'en' : 'he'));
  applyStatic();
  navigator.storage?.persist?.();
  addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { gpsOff(); wakeLock(false); } else render();
  });
  route();
  setInterval(tick, 500);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
}
boot();
