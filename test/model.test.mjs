// node test/model.test.mjs
import assert from 'node:assert/strict';
import * as M from '../model.js';

const T0 = new Date('2026-11-10T08:00:00').getTime(); // Tuesday
const C = 90, G = 22;
// Simulated taps with +-0.4s noise, missing one green, starting mid-cycle.
const noise = i => ((i * 7919) % 9 - 4) / 10;
function taps(start, cycles, skip = -1) {
  const ev = [];
  for (let k = 0; k < cycles; k++) {
    if (k !== skip) ev.push({ t: start + (k * C + noise(k)) * 1000, e: 'G' });
    ev.push({ t: start + (k * C + G + noise(k + 3)) * 1000, e: 'R' });
  }
  return ev;
}

// cycle estimation tolerates a missed change
assert.equal(M.estimateCycle([90.3, 180.2, 89.6]), 90);

const light = { id: 'a', kind: 'fixed', events: taps(T0, 4, 1) };
const m = M.lightModel(light);
assert.equal(m.C, 90);
assert.ok(Math.abs(m.Gd - 22) < 1, 'green ' + m.Gd);

// state shortly after measuring
let st = M.stateAt(m, T0 + (4 * C + 5) * 1000);
assert.ok(st.known && st.green && st.conf === 'high');
assert.ok(Math.abs(st.left - 17) < 1.5, 'left ' + st.left);
st = M.stateAt(m, T0 + (4 * C + 40) * 1000);
assert.ok(!st.green && Math.abs(st.left - 50) < 1.5);

// crossAt: arriving with 1s of green left waits for the next green
const c = M.crossAt(m, T0 + (5 * C + 21) * 1000, 3);
assert.ok(Math.abs(c.t - (T0 + 6 * C * 1000)) < 1500);

// double taps collapse
assert.equal(M.sessions([{ t: 0, e: 'G' }, { t: 1000, e: 'G' }])[0].events.length, 1);

// next-day repeat detection + same-clock-time pick
const day2 = T0 + 24 * M.H + 10 * C * 1000; // 24h is 960 cycles of 90s, so phase lines up
const m2 = M.lightModel({ id: 'a', events: [...taps(T0, 3), ...taps(day2, 2)] });
assert.equal(m2.repeat, true);
const p = M.pick(m2, T0 + 7 * 24 * M.H + 60e3); // a week later, same time of day
assert.equal(p.conf, 'med');

// button light: delay from press
const b = M.lightModel({ id: 'b', kind: 'button', events: [{ t: 0, e: 'P' }, { t: 25e3, e: 'G' }, { t: 600e3, e: 'P' }, { t: 635e3, e: 'G' }] });
assert.equal(b.delay, 30);
assert.equal(M.crossAt(b, 2000e3).t, 2030e3);

// simulate + pace: slow down instead of waiting
const models = { a: m };
const tStart = T0 + (4 * C + 30) * 1000;              // red, green again in 60s
const legs = [{ dist: 140, light: 'a' }, { dist: 100, light: null }];
const sim = M.simulate(legs, tStart, 1.4, models);   // arrive after 100s: green (10s into it)
assert.equal(sim.at.length, 1);
const pc = M.pace(70, legs, tStart, models, { normal: 1.4, min: 0.8, max: 2.2, step: 0.05 });
// 70m at 1.4 m/s = 50s -> wait 10s; slower ~1.17 m/s gets there at green with same ETA
assert.ok(pc.rec.s < 1.4 && pc.rec.eta <= pc.normal.eta + 2000 && pc.rec.wait0 < 1000, JSON.stringify(pc));

console.log('model tests passed');
