// Street paths from OpenStreetMap, routed on the phone. Only the map area is requested (as with tiles).
import { haversine } from './model.js';

export const CELL = 0.01; // degrees, ~1.1 x 0.9 km; each cell is downloaded once and cached
const WALK = 'footway|path|pedestrian|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|steps|cycleway|track|corridor';
const hv = (a, b) => haversine({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

export function cellsFor(a, b, pad = 0.002) {
  const keys = [], f = x => Math.floor(x / CELL);
  for (let la = f(Math.min(a.lat, b.lat) - pad); la <= f(Math.max(a.lat, b.lat) + pad); la++)
    for (let lo = f(Math.min(a.lng, b.lng) - pad); lo <= f(Math.max(a.lng, b.lng) + pad); lo++) keys.push(`${la}_${lo}`);
  return keys;
}

export function overpassQuery(key) {
  const [la, lo] = key.split('_').map(Number);
  const box = [la * CELL, lo * CELL, (la + 1) * CELL, (lo + 1) * CELL].map(x => x.toFixed(5)).join(',');
  return `[out:json][timeout:25];way["highway"~"^(${WALK})$"]["access"!~"^(private|no)$"]["foot"!~"^no$"](${box});(._;>;);out skel qt;`;
}

// Overpass JSON -> {n: {id: [lat, lng]}, w: [[node ids]]}
export function compact(json) {
  const n = {}, w = [];
  for (const el of json?.elements || []) {
    if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') n[el.id] = [+el.lat.toFixed(6), +el.lon.toFixed(6)];
    else if (el.type === 'way' && Array.isArray(el.nodes)) w.push(el.nodes);
  }
  return { n, w };
}

// Shortest walkable path a -> b over the merged cells; [[lat, lng], ...] from a to b, or null.
export function shortest(cells, a, b, snapMax = 150) {
  const pos = Object.assign({}, ...cells.map(c => c.n)), adj = new Map(), edges = [];
  const add = (u, v, d) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push([v, d]); };
  for (const c of cells) for (const way of c.w) for (let i = 1; i < way.length; i++) {
    const u = way[i - 1], v = way[i];
    if (!pos[u] || !pos[v]) continue;
    const d = hv(pos[u], pos[v]);
    add(u, v, d); add(v, u, d); edges.push([u, v]);
  }
  // snap only to the main network: the nearest node is often on a cut-off piece (a private lane, a courtyard path)
  const comp = new Map();
  let main = -1, mainSize = 0;
  for (const s0 of adj.keys()) {
    if (comp.has(s0)) continue;
    const id = comp.size, stack = [s0];
    let size = 0;
    comp.set(s0, id);
    while (stack.length) { size++; for (const [v] of adj.get(stack.pop())) if (!comp.has(v)) { comp.set(v, id); stack.push(v); } }
    if (size > mainSize) { mainSize = size; main = id; }
  }
  // join a and b to the nearest point ON a street (not the nearest corner, which can be on another street)
  const k = Math.cos(a.lat * Math.PI / 180);
  const near = p => {
    let best = null, bd = snapMax;
    for (const [u, v] of edges) {
      if (comp.get(u) !== main) continue;
      const A = pos[u], B = pos[v], ax = (A[1] - p.lng) * k, ay = A[0] - p.lat, dx = (B[1] - A[1]) * k, dy = B[0] - A[0], L2 = dx * dx + dy * dy;
      const f = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const q = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f], d = hv(q, [p.lat, p.lng]);
      if (d < bd) { bd = d; best = { u, v, q }; }
    }
    return best;
  };
  const S = near(a), E = near(b);
  if (!S || !E) return null;
  const s = 's', t = 't';
  pos.s = S.q; pos.t = E.q;
  for (const [id, x] of [[s, S], [t, E]]) for (const n of [x.u, x.v]) { const d = hv(x.q, pos[n]); add(id, n, d); add(n, id, d); }
  if ((S.u === E.u && S.v === E.v) || (S.u === E.v && S.v === E.u)) { const d = hv(S.q, E.q); add(s, t, d); add(t, s, d); } // same street segment
  const dist = new Map([[s, 0]]), prev = new Map(), heap = [[0, s]];
  const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === t) break;
    if (d > dist.get(u)) continue;
    for (const [v, w] of adj.get(u)) {
      if (d + w < (dist.get(v) ?? Infinity)) { dist.set(v, d + w); prev.set(v, u); push([d + w, v]); }
    }
  }
  if (!dist.has(t)) return null;
  const ids = [t];
  while (ids[0] !== s) ids.unshift(prev.get(ids[0]));
  const out = [[a.lat, a.lng], ...ids.map(id => pos[id]), [b.lat, b.lng]].filter((p, i, x) => !i || hv(p, x[i - 1]) > 0.5);
  // a path 3x the straight line is almost always bad map data (a missing crossing): leave it straight, the user can draw it
  let len = 0;
  for (let i = 1; i < out.length; i++) len += hv(out[i - 1], out[i]);
  return len > 3 * hv(out[0], out.at(-1)) + 300 ? null : out;
}
