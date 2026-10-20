"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const C = require(path.resolve(__dirname, "../../../lib/gesture-counter.js"));
const S = require("./synth.js");

function gesture(twists, o) {
  return S.toGestureBuffer(S.toSamples(S.rollTrace(twists, o), o));
}

// Feed a sample stream to a counter the way boot.js does, returning the
// result and when it finished.
function runCounter(dir, samples, o) {
  const c = C.createCounter(dir, 0, o);
  let t = 0, r = { done: false, severity: 0 };
  for (const s of samples) {
    t += S.SAMPLE_MS;
    r = c.push(s.x, s.y, s.z, t);
    if (r.done) return Object.assign({ atMs: t }, r);
  }
  // Watch held still afterwards: keep ticking until the counter gives up.
  while (!r.done && t < 20000) { t += S.SAMPLE_MS; r = c.tick(t); }
  return Object.assign({ atMs: t }, r);
}

test("roll is 0 face-up and follows the twist direction", function() {
  assert.ok(Math.abs(C.roll(0, 0, -1)) < 1e-9);
  assert.ok(C.roll(0, 0.5, -0.8) > 20);
  assert.ok(C.roll(0, -0.5, -0.8) < -20);
});

test("angleDiff wraps across +/-180", function() {
  assert.strictEqual(C.angleDiff(170, -170), -20);
  assert.strictEqual(C.angleDiff(-170, 170), 20);
});

test("two same-direction twists are a trigger, in either direction", function() {
  let r = C.classifyTrigger(gesture([1, 1]));
  assert.deepStrictEqual([r.isTrigger, r.dir], [true, 1], JSON.stringify(r));
  r = C.classifyTrigger(gesture([-1, -1]));
  assert.deepStrictEqual([r.isTrigger, r.dir], [true, -1], JSON.stringify(r));
});

test("three twists still trigger (tolerates an uncertain first twist)", function() {
  assert.strictEqual(C.classifyTrigger(gesture([1, 1, 1])).isTrigger, true);
});

test("a single twist, four twists, or mixed directions are not triggers", function() {
  assert.strictEqual(C.classifyTrigger(gesture([1])).isTrigger, false);
  assert.strictEqual(C.classifyTrigger(gesture([1, 1, 1, 1])).isTrigger, false);
  assert.strictEqual(C.classifyTrigger(gesture([1, -1, 1, -1])).isTrigger, false);
  assert.strictEqual(C.classifyTrigger(gesture([1, -1, 1])).isTrigger, false);
  assert.strictEqual(C.classifyTrigger(gesture([1, 1, -1])).isTrigger, false);
});

test("three twists with one overshoot still trigger", function() {
  assert.strictEqual(C.classifyTrigger(gesture([1, 1, -1, 1])).isTrigger, true);
});

test("small twists below the angle threshold are ignored", function() {
  const r = C.classifyTrigger(gesture([1, 1], { amp: 20 }));
  assert.strictEqual(r.isTrigger, false);
  assert.strictEqual(r.twists.length, 0);
});

test("trigger works away from face-up resting position", function() {
  assert.strictEqual(C.classifyTrigger(gesture([-1, -1], { base: 50 })).isTrigger, true);
});

test("walking arm swing is not a trigger", function() {
  const buf = S.toGestureBuffer(S.walking(4));
  assert.strictEqual(C.classifyTrigger(buf).isTrigger, false);
});

for (let n = 1; n <= 5; n++) {
  test("counts " + n + " reverse twist(s) as severity " + n, function() {
    const samples = S.toSamples(S.rollTrace(Array(n).fill(-1), { leadMs: 300 }));
    const r = runCounter(1, samples);
    assert.strictEqual(r.done, true);
    assert.strictEqual(r.severity, n);
  });
}

test("counting ignores swings in the trigger direction (overshoot)", function() {
  const samples = S.toSamples(S.rollTrace([-1, 1, -1, 1, -1], { leadMs: 300, amp: 55 }));
  assert.strictEqual(runCounter(1, samples).severity, 3);
});

test("counting stops early at 5", function() {
  const samples = S.toSamples(S.rollTrace(Array(7).fill(1), { leadMs: 300 }));
  const r = runCounter(-1, samples);
  assert.strictEqual(r.severity, 5);
  assert.ok(r.atMs < samples.length * S.SAMPLE_MS, "finished before the stream ended");
});

test("no reverse twist within the timeout gives severity 0", function() {
  const samples = S.toSamples(S.rollTrace([], { leadMs: 4000, tailMs: 0 }));
  const r = runCounter(1, samples);
  assert.deepStrictEqual([r.done, r.severity], [true, 0]);
  assert.ok(r.atMs <= C.DEFAULTS.firstTwistMs + S.SAMPLE_MS);
});

test("counting ends after the quiet period once twists stop", function() {
  const samples = S.toSamples(S.rollTrace([-1, -1], { leadMs: 200, tailMs: 3000 }));
  const r = runCounter(1, samples);
  assert.strictEqual(r.severity, 2);
  const lastTwistEnd = 200 + 2 * 560 + 120;
  assert.ok(r.atMs < lastTwistEnd + C.DEFAULTS.quietMs + 400, "stopped at " + r.atMs);
});

test("slow rhythmic twists still count", function() {
  const samples = S.toSamples(S.rollTrace([-1, -1, -1], { twistMs: 1100, gapMs: 300, leadMs: 300 }));
  assert.strictEqual(runCounter(1, samples).severity, 3);
});

test("confidence handles float softmax and int8 outputs", function() {
  assert.strictEqual(C.confidence([0.1, 0.9]), 0.9);
  assert.strictEqual(C.confidence([-128, 127]), 1);
  assert.strictEqual(C.confidence([]), 0);
});
