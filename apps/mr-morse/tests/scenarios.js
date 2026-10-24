"use strict";

// Everyday life, synthesised for the accelerometer. Each scenario builds a
// raw 400 Hz signal (tests/helpers/accel-sim.js) from a seed, so any failure
// is reproducible. Four kinds:
//   everyday   must never arm the engine (no echo buzz, nothing logged)
//   scattered  knocks scattered at random onto a still or slow-moving wrist:
//              no rhythm and no quick movement to give them away, so now
//              and then three line up like the password. Rare by default,
//              rarer still with Tap direction set.
//   intent     the user's real password: logs what was tapped, never a wrong
//              number
//   limit      a known trade-off, pinned so a change in behaviour is noticed
// The names match the field-test sessions in FIELD-TESTS.md.

const path = require("node:path");
const sim = require(path.resolve(__dirname, "../../../tests/helpers/accel-sim.js"));

const MIN = 60000;
const deg = (d) => d * Math.PI / 180;
const span = (r, lohi) => r.range(lohi[0], lohi[1]);

// A wrist pose that wanders slowly around a base orientation.
function wander(r, base, ampDeg, periodMs) {
  const a = deg(ampDeg), p1 = periodMs * r.range(0.7, 1.3), p2 = periodMs * r.range(0.7, 1.3);
  const f1 = r() * 6.28, f2 = r() * 6.28;
  return (t) => ({
    pitch: base.pitch + a * Math.sin(2 * Math.PI * t / p1 + f1),
    roll: base.roll + a * Math.sin(2 * Math.PI * t / p2 + f2)
  });
}

// Periodic movement of the forearm: amp (g) along axis at hz, from..to.
function stroke(sig, axis, amp, hz, from, to) {
  sim.addOscillation(sig, axis, amp, hz, from, to);
}

// Low-frequency, irregular movement (cooking, fidgeting, a car's sway).
function shuffle(sig, r, amp, from, to) {
  const parts = [0, 1, 2].map(() => ({ hz: r.range(0.3, 2), ph: r() * 6.28, a: amp * r.range(0.4, 1) }));
  parts.forEach((p, axis) => sim.addOscillation(sig, axis, p.a, p.hz, from, to, p.ph));
}

// axis: 0-2 for a random sign along that axis, or a vector to stay near.
function knock(sig, r, t, peak, width, axis, extra) {
  const dir = Array.isArray(axis) ? r.near(axis) : r.dir(axis);
  sim.addImpact(sig, Object.assign({ t: t, peak: peak, widthMs: width, dir: dir }, extra || {}));
}

// A finger on the face pushes the watch into the wrist; a jolt through a desk
// or a wheel comes up from underneath.
const FACE = [0, 0, -1], UNDER = [0, 0, 1];

// Poisson arrivals at `perSec` between from and to.
function arrivals(r, perSec, from, to) {
  const out = [];
  for (let t = from - Math.log(1 - r()) * 1000 / perSec; t < to; t -= Math.log(1 - r()) * 1000 / perSec) out.push(t);
  return out;
}

// --- Everyday building blocks -------------------------------------------

// Patting a back with the watch hand: bursts of strokes, each ending in a
// soft impact; sometimes a circular rub with no impacts at all.
function patting(sig, r, from, to, o) {
  o = Object.assign({ hz: [1.5, 3], burst: [5000, 25000], pause: [1000, 6000],
    peak: [0.6, 3], width: [8, 35], arm: [0.2, 0.8], soft: 0.15 }, o);
  let t = from;
  while (t < to) {
    const end = Math.min(to, t + span(r, o.burst)), hz = span(r, o.hz), axis = r.int(0, 2);
    if (r.chance(0.15)) {
      shuffle(sig, r, span(r, o.arm) * 0.5, t, end);           // rubbing
    } else {
      stroke(sig, axis, span(r, o.arm), hz, t, end);
      for (let k = t + 250 / hz; k < end; k += (1000 / hz) * r.range(0.9, 1.1)) {
        if (!r.chance(o.soft)) knock(sig, r, k, span(r, o.peak), span(r, o.width), axis, { recoil: 0.02 });
      }
    }
    t = end + span(r, o.pause);
  }
}

function walking(sig, r, from, to, o) {
  o = Object.assign({ hz: [1.6, 2.0], swing: [0.25, 0.6], heel: [0.3, 0.9], heelW: [20, 50] }, o);
  const hz = span(r, o.hz);
  stroke(sig, 1, span(r, o.swing), hz / 2, from, to);           // arm swings once per two steps
  for (let t = from + r.range(0, 500); t < to; t += (1000 / hz) * r.range(0.95, 1.05)) {
    knock(sig, r, t, span(r, o.heel), span(r, o.heelW), r.int(0, 1), { ring: 0.1, recoil: 0.1 });
  }
}

const SCENARIOS = [];
function scenario(s) { SCENARIOS.push(s); }

// Every scenario's build(r) returns {sig}, and intent scenarios also
// {attempts: [{severity, start, end}]}: what the user tapped and when, so a
// log can be told apart from a false one. pose and noise are added here so
// each build only describes what's different about it.
function base(r, ms, pose, noise) {
  const sig = sim.createSignal(ms);
  sim.addGravity(sig, pose);
  sim.addNoise(sig, r, noise || { tremor: 0.01 });
  return sig;
}

// --- Everyday: must never arm --------------------------------------------

scenario({
  name: "burp-pat", kind: "everyday",
  title: "Burping a baby: patting their back with the watch hand",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(60), roll: deg(20) }, 15, 4000));
    patting(sig, r, 0, sig.durationMs);
    return { sig: sig };
  }
});

scenario({
  name: "burp-hold", kind: "scattered",
  title: "Burping: the watch arm holds the baby, the other hand pats",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(40), roll: deg(-30) }, 6, 6000), { tremor: 0.01 });
    const sway = r.range(0.3, 0.6);
    sim.addOscillation(sig, 1, 0.06, sway, 0, sig.durationMs);
    // The pats arrive through the baby: weaker, blunter, the same rhythm.
    patting(sig, r, 0, sig.durationMs, { peak: [0.3, 1.5], width: [15, 40], arm: [0.01, 0.05], soft: 0.3 });
    return { sig: sig };
  }
});

scenario({
  name: "bouncing", kind: "everyday",
  title: "Bouncing a baby on the arm, with the odd bump from their head or feet",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(50), roll: deg(0) }, 10, 5000));
    let t = 0;
    while (t < sig.durationMs) {
      const end = t + r.range(10000, 40000);
      stroke(sig, 2, r.range(0.15, 0.4), r.range(1.5, 2.2), t, end);
      arrivals(r, 0.3, t, end).forEach((k) => knock(sig, r, k, r.range(0.3, 1.5), r.range(10, 30), r.int(0, 2)));
      t = end + r.range(2000, 8000);
    }
    return { sig: sig };
  }
});

scenario({
  name: "swing-knock", kind: "everyday",
  title: "Walking with the arm swinging, knocking the watch on door frames, tables, bags",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(-80), roll: deg(0) }, 20, 1100));
    walking(sig, r, 0, sig.durationMs);
    arrivals(r, 1 / 15, 0, sig.durationMs).forEach((t) => {
      const hits = r.chance(0.15) ? r.int(2, 3) : 1;              // a fumble
      for (let i = 0; i < hits; i++) {
        const tt = t + i * r.range(150, 600), peak = r.range(1.5, 8), w = r.range(3, 10), axis = r.int(0, 2);
        knock(sig, r, tt, peak, w, axis);
        if (r.chance(0.4)) knock(sig, r, tt + r.range(50, 200), peak * r.range(0.3, 0.7), w, axis);  // rebound
      }
    });
    return { sig: sig };
  }
});

// Knock patterns, in ms. The last but one is the password's own rhythm:
// only the moving arm gives it away.
const KNOCKS = [[0, 250, 500], [0, 220, 440, 660], [0, 180, 360, 540, 720], [0, 300], [0, 230, 930], [0, 200, 400, 1000, 1200]];

scenario({
  name: "door-knock", kind: "everyday",
  title: "Knocking on doors with the watch hand, including knock-knock ... knock",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(-70), roll: deg(0) }, 8, 8000));
    let t = 3000;
    while (t < sig.durationMs - 5000) {
      const pat = r.pick(KNOCKS), end = pat[pat.length - 1];
      // The forearm swings into each knock and drops away afterwards.
      stroke(sig, 2, r.range(0.6, 1.2), r.range(3, 4.5), t - 400, t + end + 600);
      pat.forEach((k) => knock(sig, r, t + k, r.range(2, 6), r.range(2, 6), 2));
      t += end + r.range(15000, 45000);
    }
    return { sig: sig };
  }
});

scenario({
  name: "clapping", kind: "everyday",
  title: "Applause, and clap-along rhythms like clap-clap ... clap",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(20), roll: deg(60) }, 10, 3000));
    let t = 2000;
    while (t < sig.durationMs - 15000) {
      const end = t + r.range(3000, 12000);
      stroke(sig, 0, r.range(0.8, 1.5), r.range(2, 4), t - 300, end + 300);
      if (r.chance(0.5)) {
        for (let k = t; k < end; k += 1000 / r.range(3, 5)) knock(sig, r, k, r.range(2, 5), r.range(4, 10), 0);
      } else {
        const beat = r.range(300, 450);
        for (let k = t; k < end; k += beat * 4) [0, 1, 3].forEach((b) => knock(sig, r, k + b * beat, r.range(2, 5), r.range(4, 10), 0));
      }
      t = end + r.range(5000, 30000);
    }
    return { sig: sig };
  }
});

scenario({
  name: "typing", kind: "scattered",
  title: "Typing with the wrist on the desk: keystrokes, hard keys, mouse, wrist set down",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(-10), roll: deg(5) }, 2, 20000), { tremor: 0.005 });
    let t = 0;
    while (t < sig.durationMs) {
      const end = Math.min(sig.durationMs, t + r.range(5000, 40000));
      for (let k = t; k < end; k += r.range(80, 300)) {
        const hard = r.chance(0.08);
        knock(sig, r, k, hard ? r.range(0.5, 1.6) : r.range(0.03, 0.25), r.range(5, 15), UNDER, { recoil: 0.01 });
      }
      if (r.chance(0.5)) shuffle(sig, r, 0.08, end, end + r.range(500, 2000));         // the mouse
      if (r.chance(0.3)) {                                                             // lift and set down
        const at = end + r.range(500, 3000), peak = r.range(1, 3);
        shuffle(sig, r, 0.2, at - 300, at);
        knock(sig, r, at, peak, r.range(8, 20), UNDER);
        if (r.chance(0.5)) knock(sig, r, at + r.range(60, 150), peak * r.range(0.3, 0.5), r.range(8, 20), UNDER);
      }
      t = end + r.range(2000, 20000);
    }
    return { sig: sig };
  }
});

scenario({
  name: "drumming", kind: "scattered",
  title: "Drumming fingers on the desk beside the watch wrist",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(-5), roll: deg(0) }, 2, 20000), { tremor: 0.005 });
    let t = 1000;
    while (t < sig.durationMs - 5000) {
      const end = t + r.range(3000, 15000);
      for (let k = t; k < end; k += r.range(400, 1600)) {
        const fingers = r.int(1, 4), roll = r.range(30, 70);
        for (let f = 0; f < fingers; f++) knock(sig, r, k + f * roll, r.range(0.3, 1.4), r.range(5, 12), UNDER, { recoil: 0.01 });
      }
      t = end + r.range(5000, 40000);
    }
    return { sig: sig };
  }
});

scenario({
  name: "driving", kind: "scattered",
  title: "Hands on the wheel: road buzz, potholes hit by front then rear wheels",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(-30), roll: deg(70) }, 10, 7000), { rms: 0.03, tremor: 0.01 });
    shuffle(sig, r, 0.08, 0, sig.durationMs);                                         // braking, turning
    arrivals(r, r.range(0.02, 0.15), 0, sig.durationMs).forEach((t) => {
      const peak = r.range(0.3, 2), w = r.range(10, 40), axis = r.int(0, 2);
      knock(sig, r, t, peak, w, axis, { recoil: 0.1 });
      knock(sig, r, t + r.range(150, 350), peak * r.range(0.5, 1), w, axis, { recoil: 0.1 });
    });
    return { sig: sig };
  }
});

scenario({
  name: "walking", kind: "everyday",
  title: "Walking briskly",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(-80), roll: deg(0) }, 20, 1100));
    walking(sig, r, 0, sig.durationMs);
    return { sig: sig };
  }
});

scenario({
  name: "running", kind: "everyday",
  title: "Running: hard, regular footfalls and a big arm swing",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(-30), roll: deg(0) }, 25, 800));
    walking(sig, r, 0, sig.durationMs, { hz: [2.5, 3], swing: [0.5, 1], heel: [1, 2.5], heelW: [15, 35] });
    return { sig: sig };
  }
});

scenario({
  name: "chores", kind: "scattered",
  title: "Washing up and cooking: clinks from every direction, chopping",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(30), roll: deg(20) }, 25, 3000));
    shuffle(sig, r, 0.3, 0, sig.durationMs);
    arrivals(r, r.range(0.3, 1), 0, sig.durationMs).forEach((t) => knock(sig, r, t, r.range(0.5, 4), r.range(3, 12), r.int(0, 2)));
    let t = r.range(0, 60000);
    while (t < sig.durationMs) {
      const end = t + r.range(5000, 20000), hz = r.range(3, 5);
      for (let k = t; k < end; k += 1000 / hz) knock(sig, r, k, r.range(1, 3), r.range(5, 12), 2);
      t = end + r.range(60000, 180000);
    }
    return { sig: sig };
  }
});

scenario({
  name: "sleep", kind: "everyday",
  title: "Asleep: still, rolling over, a hand hitting the headboard",
  build: function(r) {
    const sig = base(r, 10 * MIN, wander(r, { pitch: deg(10), roll: deg(80) }, 1, 4000), { tremor: 0.002 });
    arrivals(r, 1 / 120, 0, sig.durationMs).forEach((t) => {
      const turn = r.range(2000, 3000);
      shuffle(sig, r, 0.35, t, t + turn);
      if (r.chance(0.5)) knock(sig, r, t + r.range(0, turn), r.range(1, 4), r.range(5, 20), r.int(0, 2));
    });
    return { sig: sig };
  }
});

scenario({
  name: "day-mix", kind: "scattered",
  title: "A bit of everything back to back, with quiet gaps between",
  build: function(r) {
    const sig = base(r, 15 * MIN, wander(r, { pitch: deg(0), roll: deg(0) }, 30, 30000));
    const seg = 2.5 * MIN;
    patting(sig, r, 0, seg);
    walking(sig, r, seg + 3000, 2 * seg);
    arrivals(r, 1 / 10, seg, 2 * seg).forEach((t) => knock(sig, r, t, r.range(1.5, 6), r.range(3, 10), r.int(0, 2)));
    for (let k = 2 * seg + 3000; k < 3 * seg; k += r.range(80, 300)) knock(sig, r, k, r.chance(0.08) ? r.range(0.5, 1.6) : 0.1, 8, UNDER);
    shuffle(sig, r, 0.3, 3 * seg + 3000, 4 * seg);
    arrivals(r, 0.6, 3 * seg + 3000, 4 * seg).forEach((t) => knock(sig, r, t, r.range(0.5, 4), r.range(3, 12), r.int(0, 2)));
    patting(sig, r, 4 * seg + 3000, 5 * seg, { peak: [0.3, 1.5], width: [15, 40], arm: [0.01, 0.05] });
    stroke(sig, 0, 1, 3, 5 * seg + 3000, 6 * seg);
    for (let k = 5 * seg + 3000; k < 6 * seg; k += 280) knock(sig, r, k, r.range(2, 5), 6, 0);
    return { sig: sig };
  }
});

// --- Intent: the real password must still work -----------------------------

// The user's rhythm, measured on the watch: the pair ~230 ms apart, the last
// tap ~700 ms later. Severity taps start once the echo has been felt.
// Returns the time of the last tap.
function password(sig, r, t, severity, o) {
  o = Object.assign({ pair: [170, 300], ratio: [2.5, 4], peak: [1.8, 4] }, o);
  const pair = span(r, o.pair);
  const pause = Math.max(480, Math.min(1300, pair * span(r, o.ratio)));
  const tap = (tt) => knock(sig, r, tt, span(r, o.peak), r.range(4, 12), FACE);
  tap(t);
  tap(t + pair);
  tap(t + pair + pause);
  let c = t + pair + pause + r.range(2400, 3000);
  for (let i = 0; i < severity; i++) { tap(c); c += r.range(250, 450); }
  return c;
}

function attempts(sig, r, from, o) {
  const out = [];
  let t = from;
  while (t < sig.durationMs - 30000) {
    const s = r.int(1, 5), end = password(sig, r, t, s, o);
    out.push({ severity: s, start: t, end: end });
    t = end + r.range(12000, 25000);
  }
  return out;
}

scenario({
  name: "password-seated", kind: "intent",
  title: "Password then severity, wrist resting on a table or thigh",
  build: function(r) {
    const sig = base(r, 3 * MIN, wander(r, { pitch: deg(-10), roll: deg(5) }, 2, 20000), { tremor: 0.006 });
    return { sig: sig, attempts: attempts(sig, r, 3000) };
  }
});

scenario({
  name: "password-held", kind: "intent",
  title: "Password with the watch arm held up unsupported",
  build: function(r) {
    const sig = base(r, 3 * MIN, wander(r, { pitch: deg(40), roll: deg(10) }, 5, 6000), { tremor: 0.02 });
    return { sig: sig, attempts: attempts(sig, r, 3000) };
  }
});

scenario({
  name: "password-in-bed", kind: "intent", minHits: 0.9, maxShort: 0.01,
  title: "Password at 3am, wrist on a pillow, taps softened (a soft one may not register)",
  build: function(r) {
    const sig = base(r, 3 * MIN, wander(r, { pitch: deg(10), roll: deg(80) }, 1, 4000), { tremor: 0.003 });
    return { sig: sig, attempts: attempts(sig, r, 3000, { peak: [1.4, 2.5] }) };
  }
});

scenario({
  name: "password-after-typing", kind: "intent",
  title: "Typing, stop for a couple of seconds, then the password",
  build: function(r) {
    const sig = base(r, 3 * MIN, wander(r, { pitch: deg(-10), roll: deg(5) }, 2, 20000), { tremor: 0.005 });
    const out = [];
    let t = 0;
    while (t < sig.durationMs - 40000) {
      const stop = t + r.range(5000, 15000);
      for (let k = t; k < stop; k += r.range(80, 300)) knock(sig, r, k, r.chance(0.08) ? r.range(0.5, 1.6) : r.range(0.03, 0.25), 8, UNDER);
      const s = r.int(1, 5), start = stop + r.range(1500, 3000), end = password(sig, r, start, s);
      out.push({ severity: s, start: start, end: end });
      t = end + r.range(5000, 10000);
    }
    return { sig: sig, attempts: out };
  }
});

// --- Limits: known trade-offs ---------------------------------------------

scenario({
  name: "password-walking", kind: "limit", reject: "moving",
  title: "Password while walking: refused, the wrist is moving",
  build: function(r) {
    const sig = base(r, 2 * MIN, wander(r, { pitch: deg(30), roll: deg(0) }, 10, 1100));
    walking(sig, r, 0, sig.durationMs, { swing: [0.2, 0.4], heel: [0.3, 0.6] });
    attempts(sig, r, 3000);
    return { sig: sig };
  }
});

scenario({
  name: "password-too-soon", kind: "limit", reject: "busy",
  title: "Password started within a second of a knock: refused, not from quiet",
  build: function(r) {
    const sig = base(r, 2 * MIN, wander(r, { pitch: deg(-10), roll: deg(5) }, 2, 20000), { tremor: 0.006 });
    for (let t = 3000; t < sig.durationMs - 20000; t += 20000) {
      knock(sig, r, t, r.range(2, 4), 6, FACE);
      password(sig, r, t + r.range(400, 800), 2);
    }
    return { sig: sig };
  }
});

module.exports = { SCENARIOS: SCENARIOS, MIN: MIN };
