"use strict";

// Synthetic Bangle.js 2 accelerometer, for testing tap-driven code against
// everyday life without a watch on a wrist.
//
// A session is built as raw acceleration at 400 Hz (the KX022's tap-engine
// rate): gravity seen through the wrist's pose, the arm's own movement,
// impacts, tremor and sensor noise. sense() then turns it into what the
// firmware hands to JavaScript:
//   - "tap" events, from a model of the KX022's tap engine (high-pass filter,
//     threshold, pulse-width window, optional double-tap fusing), or in the
//     "every-impact" stress mode, one tap for every impact regardless.
//   - "accel" events at 12.5 Hz, {x, y, z, diff, mag} in g, where diff is the
//     length of the change since the previous reading, as the firmware
//     computes it.
//
// The tap-engine constants are a model, not the datasheet: real recordings
// (apps/<appid>/tests/recordings) carry the chip's own tap events and bypass
// it entirely.

const FS = 400;          // Hz
const DT = 1000 / FS;    // ms per sample
const RANGE_G = 4;       // the firmware runs the KX022 at +-4 g
const LSB = 1 / 8192;    // ...with 8192 counts per g

// Seeded PRNG (mulberry32) so every scenario is reproducible from its seed.
function rng(seed) {
  let a = (seed >>> 0) || 1;
  const r = function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(r.range(lo, hi + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.gauss = () => {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  // A unit vector near `v`, a few degrees off.
  r.near = (v) => {
    const out = [v[0] + r.gauss() * 0.15, v[1] + r.gauss() * 0.15, v[2] + r.gauss() * 0.15];
    const n = Math.hypot(out[0], out[1], out[2]) || 1;
    return [out[0] / n, out[1] / n, out[2] / n];
  };
  // A random unit vector, biased towards one axis when `axis` is given.
  r.dir = (axis) => {
    const v = [r.gauss() * 0.3, r.gauss() * 0.3, r.gauss() * 0.3];
    if (axis !== undefined) v[axis] += r.chance(0.5) ? 1 : -1;
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  return r;
}

function createSignal(durationMs) {
  const n = Math.ceil(durationMs / DT);
  return {
    n: n,
    durationMs: durationMs,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    impacts: []          // ground truth: every impact added, for stress mode
  };
}

function span(sig, fromMs, toMs) {
  const a = Math.max(0, Math.floor((fromMs || 0) / DT));
  const b = Math.min(sig.n, Math.ceil((toMs === undefined ? sig.durationMs : toMs) / DT));
  return [a, b];
}

// Gravity through the wrist's pose. pose(t) -> {pitch, roll} in radians;
// {0, 0} is the watch lying flat, face up, which reads z = -1 g. The pose
// changes slowly, so it's evaluated every 10 ms.
function addGravity(sig, pose) {
  let gx = 0, gy = 0, gz = -1;
  for (let i = 0; i < sig.n; i++) {
    if (pose && i % 4 === 0) {
      const p = pose(i * DT), cr = Math.cos(p.roll);
      gx = Math.sin(p.roll);
      gy = Math.sin(p.pitch) * cr;
      gz = -Math.cos(p.pitch) * cr;
    }
    sig.x[i] += gx;
    sig.y[i] += gy;
    sig.z[i] += gz;
  }
}

// Periodic movement along one axis: amp (g) at hz from fromMs to toMs,
// starting at phase (radians).
function addOscillation(sig, axis, amp, hz, fromMs, toMs, phase) {
  const [a, b] = span(sig, fromMs, toMs);
  const arr = [sig.x, sig.y, sig.z][axis], w = 2 * Math.PI * hz * DT / 1000, i0 = (fromMs || 0) / DT;
  for (let i = a; i < b; i++) arr[i] += amp * Math.sin(w * (i - i0) + (phase || 0));
}

// Linear acceleration of the wrist: fn(t) -> [x, y, z] in g.
function addMotion(sig, fn, fromMs, toMs) {
  const [a, b] = span(sig, fromMs, toMs);
  for (let i = a; i < b; i++) {
    const v = fn(i * DT);
    if (!v) continue;
    sig.x[i] += v[0];
    sig.y[i] += v[1];
    sig.z[i] += v[2];
  }
}

// One knock: a half-sine pulse, a short ring as the strap and case settle,
// and a slow recoil as the forearm absorbs the push.
//   t, peak (g), widthMs, dir [x,y,z] unit
//   ring: fraction of peak (default 0.3), recoil: fraction of peak (0.04)
function addImpact(sig, o) {
  const ring = o.ring === undefined ? 0.3 : o.ring;
  const recoil = o.recoil === undefined ? 0.04 : o.recoil;
  const ringHz = o.ringHz || 120, ringMs = o.ringMs || 6;
  const end = o.t + o.widthMs;
  const [a, b] = span(sig, o.t, end + 300);
  for (let i = a; i < b; i++) {
    const t = i * DT;
    let v = 0;
    if (t < end) v += o.peak * Math.sin(Math.PI * (t - o.t) / o.widthMs);
    else v += o.peak * ring * Math.exp(-(t - end) / ringMs) * Math.sin(2 * Math.PI * ringHz * (t - end) / 1000);
    v -= o.peak * recoil * Math.exp(-(t - o.t) / 70) * Math.sin(2 * Math.PI * 6 * (t - o.t) / 1000);
    sig.x[i] += v * o.dir[0];
    sig.y[i] += v * o.dir[1];
    sig.z[i] += v * o.dir[2];
  }
  sig.impacts.push({ t: o.t, peak: o.peak, widthMs: o.widthMs, dir: o.dir });
}

// Sensor noise (white, per axis) plus physiological tremor (8-12 Hz) whose
// strength drifts. tremor is the peak amplitude in g.
// White noise comes from a table of gaussians picked at random: far quicker
// than a fresh Box-Muller draw per sample, and just as white.
const GAUSS = (function() {
  const r = rng(12345), t = new Float32Array(4096);
  for (let i = 0; i < t.length; i++) t[i] = r.gauss();
  return t;
})();

function addNoise(sig, r, o) {
  o = o || {};
  const rms = o.rms === undefined ? 0.01 : o.rms;
  const tremor = o.tremor || 0;
  const hz = r.range(8, 12), d = r.dir();
  let amp = tremor, phase = r() * 6.28;
  const [a, b] = span(sig, o.from, o.to);
  const g = () => GAUSS[(r() * 4096) | 0];
  for (let i = a; i < b; i++) {
    if (i % 400 === 0) amp = tremor * r.range(0.5, 1.5);
    phase += 2 * Math.PI * hz / FS;
    const tr = amp * Math.sin(phase);
    sig.x[i] += rms * g() + tr * d[0];
    sig.y[i] += rms * g() + tr * d[1];
    sig.z[i] += rms * g() + tr * d[2];
  }
}

// --- What the firmware reports -----------------------------------------

const clip = (v) => Math.max(-RANGE_G, Math.min(RANGE_G, v));
const AXES = [["left", "right"], ["bottom", "top"], ["front", "back"]];

// Model of the KX022 tap engine. A tap is a pulse in the high-passed
// "performance index" (|x|+|y|+|z|) that rises over tthG and falls back under
// ttlG within minMs..maxMs: sharp knocks pass, pushes and swings don't.
// After a tap the engine is deaf for deadMs (its own ringing). Its direction
// is the axis and sign of the strongest component.
// With double:true the chip's double-tap detection is on, read from the
// datasheet defaults: a second tap 300 ms (TDTC) to 400 ms (TWS) after the
// first is fused into one "double", and every tap is reported only once that
// window has closed.
const KX022 = { hpfHz: 20, tthG: 1.0, ttlG: 0.25, minMs: 2, maxMs: 50, deadMs: 50,
  doubleMinMs: 300, doubleMaxMs: 400, double: false };

function tapEngine(sig, opts) {
  const o = Object.assign({}, KX022, opts || {});
  const rc = 1000 / (2 * Math.PI * o.hpfHz);
  const alpha = rc / (rc + DT);
  let px = clip(sig.x[0]), py = clip(sig.y[0]), pz = clip(sig.z[0]);
  let hx = 0, hy = 0, hz = 0;
  let above = false, high = false, start = 0, deadUntil = -1, peak = 0, peakAxis = 0, peakSign = 1;
  const raw = [];
  for (let i = 1; i < sig.n; i++) {
    const x = clip(sig.x[i]), y = clip(sig.y[i]), z = clip(sig.z[i]);
    hx = alpha * (hx + x - px); hy = alpha * (hy + y - py); hz = alpha * (hz + z - pz);
    px = x; py = y; pz = z;
    if (i < deadUntil) continue;
    const pi = Math.abs(hx) + Math.abs(hy) + Math.abs(hz);
    if (!above) {
      if (pi > o.ttlG) { above = true; high = false; start = i; peak = 0; }
      else continue;
    }
    if (pi > o.tthG) high = true;
    const comps = [hx, hy, hz];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(comps[k]) > peak) { peak = Math.abs(comps[k]); peakAxis = k; peakSign = comps[k] > 0 ? 0 : 1; }
    }
    if (pi < o.ttlG) {
      above = false;
      const width = (i - start) * DT;
      if (high && width >= o.minMs && width <= o.maxMs) {
        raw.push({ t: i * DT, dir: AXES[peakAxis][peakSign] });
        deadUntil = i + o.deadMs / DT;
      }
    }
  }
  return report(raw, o);
}

function report(raw, o) {
  if (!o.double) return raw.map((r) => ({ t: r.t, dir: r.dir, double: false }));
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const next = raw[i + 1], gap = next ? next.t - raw[i].t : Infinity;
    if (gap >= o.doubleMinMs && gap <= o.doubleMaxMs) {
      out.push({ t: raw[i].t + o.doubleMaxMs, dir: raw[i].dir, double: true });
      i++;
    } else {
      out.push({ t: raw[i].t + o.doubleMaxMs, dir: raw[i].dir, double: false });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function dirName(v) {
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[k])) k = i;
  return AXES[k][v[k] > 0 ? 0 : 1];
}

// The 12.5 Hz stream: each reading is the mean of the last period (the
// chip's output filter), quantised, with the firmware's diff and mag.
function accelStream(sig, periodMs) {
  const per = Math.round((periodMs || 80) / DT);
  const out = [];
  let prev = null;
  for (let k = per; k <= sig.n; k += per) {
    let sx = 0, sy = 0, sz = 0;
    for (let i = k - per; i < k; i++) { sx += clip(sig.x[i]); sy += clip(sig.y[i]); sz += clip(sig.z[i]); }
    const q = (v) => Math.round(v / per / LSB) * LSB;
    const s = { t: k * DT, x: q(sx), y: q(sy), z: q(sz) };
    s.diff = prev ? Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z) : 0;
    s.mag = Math.hypot(s.x, s.y, s.z);
    out.push(s);
    prev = s;
  }
  return out;
}

// tapMode: "single" (chip reports every tap alone), "double" (chip fuses
// quick pairs), or "every-impact" (stress: each impact over minImpactG is a
// tap, whatever the chip would have made of it).
function sense(sig, o) {
  o = o || {};
  const mode = o.tapMode || "single";
  let taps;
  if (mode === "every-impact") {
    const min = o.minImpactG === undefined ? 0.3 : o.minImpactG;
    taps = sig.impacts.filter((m) => m.peak >= min)
      .map((m) => ({ t: m.t + m.widthMs, dir: dirName(m.dir), double: false }))
      .sort((a, b) => a.t - b.t);
  } else {
    taps = tapEngine(sig, Object.assign({}, o.kx022, { double: mode === "double" }));
  }
  return { taps: taps, accel: accelStream(sig, o.periodMs) };
}

// Merge sensed events into one time-ordered list for a replay harness.
function timeline(sensed, extra) {
  const ev = [];
  sensed.taps.forEach((t) => ev.push({ t: t.t, type: "tap", dir: t.dir, double: t.double }));
  sensed.accel.forEach((a) => ev.push({ t: a.t, type: "accel", x: a.x, y: a.y, z: a.z, diff: a.diff, mag: a.mag }));
  (extra || []).forEach((e) => ev.push(e));
  return ev.sort((a, b) => a.t - b.t);
}

module.exports = {
  FS, DT, KX022,
  rng, createSignal, addGravity, addMotion, addOscillation, addImpact, addNoise,
  tapEngine, accelStream, sense, timeline
};
