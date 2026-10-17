#!/usr/bin/env node
// Writes a synthetic gsym.samples.csv so the training pipeline can be tried
// before recording real gestures. Real recordings will differ; don't install
// a model trained only on this.
//
// Usage: node tools/gesture-train/synthetic.js > synthetic.csv

const S = require("../../apps/gesture_symptoms/tests/synth.js");

const rand = S.rng(42);
const r01 = () => (rand() + 1) / 2;

function row(label, samples) {
  const buf = S.toGestureBuffer(samples.slice(0, 49));
  return label + "," + buf.length / 3 + "," + Array.from(buf).join(",");
}

function twists(dirs, seed) {
  return S.toSamples(S.rollTrace(dirs, {
    amp: 45 + 30 * r01(),
    twistMs: 450 + 300 * r01(),
    gapMs: 80 + 150 * r01(),
    leadMs: 160,
    tailMs: 240,
    base: 30 * rand()
  }), { seed: seed, noise: 0.05 });
}

const rows = [];
for (let i = 0; i < 40; i++) {
  rows.push(row("trigger", twists(i % 2 ? [1, 1] : [-1, -1], i + 1)));
}
for (let i = 0; i < 40; i++) {
  const kind = i % 4;
  let s;
  if (kind === 0) s = twists([rand() > 0 ? 1 : -1], i + 100);       // single twist
  else if (kind === 1) s = twists([1, -1, 1].slice(0, 2 + (i % 2)), i + 100); // back and forth
  else if (kind === 2) s = S.walking(2 + 1.5 * r01(), i + 100);   // arm swing
  else s = twists([1], i + 100).map((p) => ({ x: p.y, y: p.x, z: p.z })); // other axis
  rows.push(row("noise", s));
}
process.stdout.write(rows.join("\n") + "\n");
