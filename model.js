// Pure timing logic: fits light cycles from user taps, predicts state, simulates routes.
// Events: {t: epoch ms, e: 'G' (ped green started) | 'R' (red started) | 'P' (button pressed)}

const SESSION_GAP = 5 * 60e3;   // taps further apart than this belong to different visits
const DOUBLE_TAP = 3e3;         // same-kind taps closer than this are one tap
export const DETOUR = 1.25;     // straight line -> street distance, only for legs without a street or drawn path
export const H = 3600e3;

export const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mod = (a, n) => ((a % n) + n) % n;

export function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function sessions(events) {
  const out = [];
  let cur = null;
  for (const ev of [...events].sort((a, b) => a.t - b.t)) {
    if (!cur || ev.t - cur.end > SESSION_GAP) out.push(cur = { events: [], start: ev.t, end: ev.t });
    const last = cur.events.findLast(x => x.e === ev.e);
    if (!last || ev.t - last.t > DOUBLE_TAP) cur.events.push(ev);
    cur.end = ev.t;
  }
  return out;
}

function cycleDiffs(s) {
  const d = [];
  for (const k of ['G', 'R']) {
    const ts = s.events.filter(e => e.e === k).map(e => e.t);
    for (let i = 1; i < ts.length; i++) d.push((ts[i] - ts[i - 1]) / 1000);
  }
  return d.filter(x => x >= 15 && x <= 400);
}

// Diffs may span several cycles when a change was missed; divide by the multiple of the shortest.
export function estimateCycle(diffs) {
  if (!diffs.length) return null;
  const base = Math.min(...diffs);
  return Math.round(median(diffs.map(d => d / Math.max(1, Math.round(d / base))))); // controllers run whole-second cycles
}

function greenDurations(s, C) {
  const out = [], ev = s.events.filter(e => e.e !== 'P');
  for (let i = 1; i < ev.length; i++) {
    const a = ev[i - 1], b = ev[i], dt = (b.t - a.t) / 1000;
    if (C && dt >= C) continue;
    if (a.e === 'G' && b.e === 'R') out.push(dt);
    else if (C && a.e === 'R' && b.e === 'G') out.push(C - dt);
  }
  return out;
}

export function lightModel(light) {
  const ss = sessions(light.events || []);
  const C = estimateCycle(ss.flatMap(cycleDiffs));
  const Gd = median(ss.flatMap(s => greenDurations(s, estimateCycle(cycleDiffs(s)) || C)));
  const sess = ss.map(s => {
    const sc = estimateCycle(cycleDiffs(s)) || C;
    const sg = median(greenDurations(s, sc)) ?? Gd;
    const lastG = s.events.findLast(e => e.e === 'G'), lastR = s.events.findLast(e => e.e === 'R');
    let anchor = null; // a time when green started
    if (lastG && (!lastR || lastG.t > lastR.t || sg == null)) anchor = lastG.t;
    else if (lastR && sg != null) anchor = lastR.t - sg * 1000;
    return { start: s.start, end: s.end, n: s.events.length, C: sc, Gd: sg, anchor };
  });
  // Button lights: delay from press to green.
  const delays = [];
  const all = ss.flatMap(s => s.events);
  all.forEach((e, i) => {
    if (e.e !== 'P') return;
    const g = all.slice(i + 1).find(x => x.e === 'G');
    if (g && g.t - e.t < 180e3) delays.push((g.t - e.t) / 1000);
  });
  // Does the phase repeat across days at the same clock time (controller clock-synced)?
  // Compared by phase relative to local midnight (a day is rarely a whole number of cycles), and only
  // between visits at a similar clock time (each time-of-day plan has its own offset).
  const errs = [];
  const usable = sess.filter(s => s.anchor != null && s.C);
  for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
    const a = usable[i], b = usable[j];
    if (b.anchor - a.anchor < 12 * H || Math.abs(a.C - b.C) > 0.5 || todDist(a.anchor, b.anchor) > 60) continue;
    const x = mod(todS(b.anchor) - todS(a.anchor), a.C);
    errs.push(Math.min(x, a.C - x));
  }
  // a single match is often luck (8 s window out of a 60-120 s cycle): need 2+ pairs, mostly matching
  const good = errs.filter(e => e <= 4).length;
  const repeat = errs.length >= 2 && good / errs.length >= 2 / 3 ? true
    : errs.length && good === 0 && errs.every(e => e > 8) ? false : null;
  return {
    kind: light.kind || 'fixed', C, Gd, sessions: sess, repeat,
    delay: median(delays), delayMax: delays.length ? Math.max(...delays) : null, nDelays: delays.length,
    lastPress: all.findLast(e => e.e === 'P')?.t ?? null,
  };
}

const dayClass = t => { const d = new Date(t).getDay(); return d === 5 ? 1 : d === 6 ? 2 : 0; }; // Sun-Thu / Fri / Sat
const tod = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const todDist = (a, b) => { const x = Math.abs(tod(a) - tod(b)); return Math.min(x, 1440 - x); };
const todS = t => { const d = new Date(t); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000; };

// Choose the visit whose timing best represents time t: a recent one, else same clock time on a similar day.
export function pick(m, t) {
  let best = null, bestScore = Infinity;
  for (const s of m.sessions) {
    if (s.anchor == null || !s.C || s.Gd == null) continue;
    const dt = Math.abs(t - s.anchor);
    // the last hour wins; beyond that the same clock time (timing plan) matters more than recency
    const score = dt < H ? dt / 120e3
      : 20 + todDist(t, s.anchor) + (dayClass(t) !== dayClass(s.anchor) ? 240 : 0) + dt / (24 * H) * 2;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  if (!best) return null;
  const dt = Math.abs(t - best.anchor);
  const conf = dt < 0.5 * H ? 'high' : dt < 3 * H ? 'med' : m.repeat === true && todDist(t, best.anchor) <= 60 ? 'med' : 'low';
  return { ...best, conf, age: dt };
}

// {known, green, left: s until change, total: s of current phase, conf}
export function stateAt(m, t) {
  const p = m && pick(m, t);
  if (!p) return { known: false };
  // across days, project from the same clock time: survives DST and days that aren't whole cycles
  const ph = mod(p.age > 12 * H ? todS(t) - todS(p.anchor) : (t - p.anchor) / 1000, p.C);
  const green = ph < p.Gd;
  return { known: true, green, left: green ? p.Gd - ph : p.C - ph, total: green ? p.Gd : p.C - p.Gd, conf: p.conf, C: p.C, Gd: p.Gd, age: p.age };
}

// Earliest time >= t at which one can start crossing with at least minLeft s of green.
export function crossAt(m, t, minLeft = 3) {
  if (!m) return { t, known: false };
  const st = stateAt(m, t);
  if (st.known) {
    if (st.green && st.left >= minLeft) return { t, known: true, conf: st.conf };
    return { t: t + (st.green ? st.left + st.C - st.Gd : st.left) * 1000, known: true, conf: st.conf };
  }
  if (m.kind === 'button') {
    const d = (m.delay ?? 30) * 1000;
    if (m.lastPress && m.lastPress <= t && t < m.lastPress + d) return { t: m.lastPress + d, known: true, conf: 'low' };
    return { t: t + d, known: m.delay != null, conf: 'low' };
  }
  return { t, known: false };
}

// legs: [{dist (m), light?: id}] — walk dist, then cross light (if any).
export function simulate(legs, t0, speed, models, minLeft = 3) {
  let t = t0, wait = 0, unknown = 0;
  const at = [];
  for (const leg of legs) {
    t += leg.dist / speed * 1000;
    if (leg.light) {
      const c = crossAt(models[leg.light], t, minLeft);
      if (!c.known) unknown++;
      at.push({ light: leg.light, arrive: t, cross: c.t, known: c.known });
      wait += c.t - t;
      t = c.t;
    }
  }
  return { eta: t, wait, at, unknown };
}

// What to do on the way to the next light (distance d), the rest at normal speed:
// 'keep' your pace; 'ease' off to arrive as it turns green instead of waiting there; or 'hurry', but only
// when that catches an earlier green (>10 s real gain) with green to spare and the forecast is fresh.
export function pace(d, rest, t, models, { normal, min, max, step, minLeft = 3, margin = 8 }) {
  const m = models[rest[0].light];
  const run = (s, need = minLeft) => {
    const arrive = t + d / s * 1000, c = crossAt(m, arrive, need);
    return { s, cross: c.t, wait0: c.t - arrive, conf: c.conf, eta: simulate(rest.slice(1), c.t, normal, models, minLeft).eta };
  };
  const norm = run(normal);
  let rec = norm, mood = 'keep';
  if (norm.conf === 'high') for (let s = normal + step; s <= max + 1e-9; s += step) {
    const o = run(s, Math.max(minLeft, margin));
    if (o.wait0 < 1000 && o.eta < norm.eta - 10e3) { rec = o; mood = 'hurry'; break; }
  }
  if (mood === 'keep' && norm.wait0 > 1500 && d > 0) {
    const s = d / ((norm.cross + 1000 - t) / 1000);
    if (s >= min) { rec = run(s); mood = 'ease'; }
  }
  return { rec, normal: norm, mood, gain: norm.eta - rec.eta };
}

export function routeLegs(route, byId) {
  const pts = [byId[route.from], ...route.via.map(id => byId[id]), byId[route.to]];
  if (pts.some(p => !p || p.lat == null)) return null;
  return pts.slice(1).map((p, i) => {
    const a = pts[i], key = `${a.id}>${p.id}`, path = route.paths?.[key]?.pts; // src 'none' (no street found) has no pts
    // stored interior points, current endpoints (a light may have been moved since)
    const line = [[a.lat, a.lng], ...(path ? path.slice(1, -1) : []), [p.lat, p.lng]];
    return { key, dist: path ? pathLen(line) : haversine(a, p) * DETOUR, light: i < route.via.length ? p.id : null, from: a, to: p, pts: line, src: route.paths?.[key]?.src || null };
  });
}

const hv = (a, b) => haversine({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
export const pathLen = pts => pts.slice(1).reduce((s, p, i) => s + hv(pts[i], p), 0);

// Point a fraction f (0..1) of the way along a [[lat, lng], ...] line.
export function along(pts, f) {
  let left = Math.max(0, Math.min(1, f)) * pathLen(pts);
  for (let i = 1; i < pts.length; i++) {
    const seg = hv(pts[i - 1], pts[i]);
    if (left <= seg || i === pts.length - 1) {
      const k = seg ? Math.min(1, left / seg) : 0;
      return { lat: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, lng: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k };
    }
    left -= seg;
  }
  return { lat: pts[0][0], lng: pts[0][1] };
}

// Points every ~step m along the route's path; d = street distance left to the end of that leg.
export function samples(legs, step = 8) {
  const out = [];
  legs.forEach((L, i) => {
    const n = Math.max(1, Math.round(L.dist / step));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      out.push({ ...along(L.pts, f), leg: i, d: L.dist * (1 - f) });
    }
  });
  const last = legs.at(-1);
  out.push({ lat: last.to.lat, lng: last.to.lng, leg: legs.length - 1, d: 0 });
  return out;
}
