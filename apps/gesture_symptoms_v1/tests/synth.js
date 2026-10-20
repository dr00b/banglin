"use strict";

// Synthetic accelerometer traces for wrist twists, sampled like the watch
// (12.5 Hz). Roll angle -> gravity on Y/Z, matching lib/gesture-counter.js.

const SAMPLE_MS = 80;

// Deterministic pseudo-random noise so tests are repeatable.
function rng(seed) {
  let s = seed || 1;
  return function() {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
}

// twists: array of +1/-1. Each twist swings out to `amp` degrees and back over
// `twistMs`, separated by `gapMs` of rest.
function rollTrace(twists, o) {
  o = Object.assign({ amp: 60, twistMs: 560, gapMs: 120, leadMs: 400, tailMs: 400, base: 0 }, o);
  const angles = [];
  const rest = (ms) => { for (let t = 0; t < ms; t += SAMPLE_MS) angles.push(o.base); };
  rest(o.leadMs);
  twists.forEach((dir, i) => {
    for (let t = 0; t < o.twistMs; t += SAMPLE_MS) {
      angles.push(o.base + dir * o.amp * Math.sin(Math.PI * t / o.twistMs));
    }
    if (i < twists.length - 1) rest(o.gapMs);
  });
  rest(o.tailMs);
  return angles;
}

function toSamples(angles, o) {
  o = Object.assign({ noise: 0.03, seed: 7, pitchDeg: 0 }, o);
  const r = rng(o.seed);
  return angles.map((deg, i) => {
    const a = deg * Math.PI / 180;
    const p = (o.pitchDeg * Math.sin(i / 3)) * Math.PI / 180;
    return {
      x: Math.sin(p) + o.noise * r(),
      y: Math.sin(a) * Math.cos(p) + o.noise * r(),
      z: -Math.cos(a) * Math.cos(p) + o.noise * r()
    };
  });
}

// Firmware gesture buffer format: Int8Array XYZXYZ..., 64 = 1g.
function toGestureBuffer(samples) {
  const out = new Int8Array(samples.length * 3);
  samples.forEach((s, i) => {
    out[i * 3] = Math.max(-128, Math.min(127, Math.round(s.x * 64)));
    out[i * 3 + 1] = Math.max(-128, Math.min(127, Math.round(s.y * 64)));
    out[i * 3 + 2] = Math.max(-128, Math.min(127, Math.round(s.z * 64)));
  });
  return out;
}

// Arm swing while walking: mostly pitch, a little roll.
function walking(seconds, seed) {
  const r = rng(seed || 3);
  const angles = [];
  for (let t = 0; t < seconds * 1000; t += SAMPLE_MS) {
    angles.push(10 * Math.sin(2 * Math.PI * t / 1100) + 3 * r());
  }
  return toSamples(angles, { pitchDeg: 40, seed: seed || 3 });
}

module.exports = { SAMPLE_MS, rollTrace, toSamples, toGestureBuffer, walking, rng };
