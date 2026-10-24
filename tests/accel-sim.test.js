"use strict";

// The simulator has to behave like an accelerometer before anything tested
// against it means much.

const test = require("node:test");
const assert = require("node:assert");
const sim = require("./helpers/accel-sim.js");
const power = require("./helpers/power-model.js");

function still(ms, seed) {
  const r = sim.rng(seed || 1);
  const sig = sim.createSignal(ms);
  sim.addGravity(sig);
  sim.addNoise(sig, r, { tremor: 0.005 });
  return { sig: sig, r: r };
}

test("the same seed builds the same session", function() {
  const a = still(2000, 7).sig, b = still(2000, 7).sig, c = still(2000, 8).sig;
  assert.deepStrictEqual(Array.from(a.x), Array.from(b.x));
  assert.notDeepStrictEqual(Array.from(a.x), Array.from(c.x));
});

test("a still watch reads 1 g at 12.5 Hz with almost no change between readings", function() {
  const s = sim.accelStream(still(10000).sig);
  assert.strictEqual(s.length, 125, "one reading every 80 ms");
  s.forEach(function(a) { assert.ok(Math.abs(a.mag - 1) < 0.02, "mag " + a.mag); });
  s.slice(1).forEach(function(a) { assert.ok(a.diff < 0.02, "diff " + a.diff); });
});

test("a firm finger tap registers once; a push and a swing don't", function() {
  const { sig, r } = still(3000);
  sim.addImpact(sig, { t: 500, peak: 3, widthMs: 8, dir: r.near([0, 0, -1]) });
  sim.addImpact(sig, { t: 1500, peak: 3, widthMs: 150, dir: [0, 0, -1] });     // a slow push
  sim.addOscillation(sig, 1, 0.8, 2, 2000, 3000);                              // an arm swing
  const taps = sim.tapEngine(sig);
  assert.strictEqual(taps.length, 1, JSON.stringify(taps));
  assert.ok(taps[0].t > 500 && taps[0].t < 540);
  assert.strictEqual(taps[0].dir, "back", "a finger on the face pushes into the wrist");
});

test("a light touch doesn't register", function() {
  const { sig, r } = still(1000);
  sim.addImpact(sig, { t: 500, peak: 0.5, widthMs: 8, dir: r.near([0, 0, -1]) });
  assert.strictEqual(sim.tapEngine(sig).length, 0);
});

test("with double-tap detection on, only taps 300-400 ms apart fuse, and reports wait for the window", function() {
  const { sig, r } = still(5000);
  [500, 850, 2000, 2230].forEach(function(t) { sim.addImpact(sig, { t: t, peak: 3, widthMs: 6, dir: r.near([0, 0, -1]) }); });
  const taps = sim.tapEngine(sig, { double: true });
  assert.deepStrictEqual(taps.map(function(x) { return x.double; }), [true, false, false]);
  assert.ok(taps[0].t > 900 && taps[0].t < 950, "fused pair reported once the window closes");
  assert.ok(Math.abs((taps[2].t - taps[1].t) - 230) < 10, "a 230 ms pair stays two singles, gap intact");
});

test("every-impact mode reports every knock, whatever the chip model would make of it", function() {
  const { sig, r } = still(3000);
  sim.addImpact(sig, { t: 500, peak: 0.6, widthMs: 40, dir: r.near([0, 0, 1]) });
  sim.addImpact(sig, { t: 1500, peak: 3, widthMs: 6, dir: r.near([1, 0, 0]) });
  const taps = sim.sense(sig, { tapMode: "every-impact" }).taps;
  assert.deepStrictEqual(taps.map(function(x) { return x.dir; }), ["front", "left"]);
});

test("a tap barely shows in the 12.5 Hz stream; a moving arm does", function() {
  const { sig, r } = still(4000);
  sim.addImpact(sig, { t: 1000, peak: 3, widthMs: 8, dir: r.near([0, 0, -1]) });
  sim.addOscillation(sig, 1, 0.5, 2, 2500, 4000);
  const s = sim.accelStream(sig);
  const med = function(a) { const x = a.map(function(v) { return v.diff; }).sort(function(p, q) { return p - q; }); return x[x.length >> 1]; };
  assert.ok(med(s.filter(function(a) { return a.t > 800 && a.t < 1800; })) < 0.05, "still around the tap");
  assert.ok(med(s.filter(function(a) { return a.t > 2700; })) > 0.15, "moving with the swing");
});

test("timeline merges taps and readings in time order", function() {
  const { sig, r } = still(1000);
  sim.addImpact(sig, { t: 500, peak: 3, widthMs: 8, dir: r.near([0, 0, -1]) });
  const tl = sim.timeline(sim.sense(sig));
  assert.ok(tl.some(function(e) { return e.type === "tap"; }));
  for (let i = 1; i < tl.length; i++) assert.ok(tl[i].t >= tl[i - 1].t);
});

test("power model: nothing done costs nothing; a second of full-rate accel costs what CLAUDE.md says", function() {
  assert.strictEqual(power.estimate({}, 60000).extraUa, 0);
  const e = power.estimate({ fastMs: 60000 }, 60000);
  assert.ok(Math.abs(e.extraUa - 150) < 1e-9, "0.15 mA while forced to 12.5 Hz");
  assert.ok(Math.abs(e.pctOfIdle - 100) < 1e-9);
});
