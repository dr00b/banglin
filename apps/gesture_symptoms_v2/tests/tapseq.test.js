"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { createSequencer } = require(path.resolve(__dirname, "../../../lib/tap-protocol.js"));

// The user's measured rhythm: the two taps of the pair 230 ms apart, then the
// confirming tap 700 ms after that.
const PAIR_MS = 230, CONFIRM_MS = 930;

// Play the password, either as two singles or as one fused "double" event.
function password(s, t0, fused) {
  if (fused) s.tap(true, t0);
  else { s.tap(false, t0); s.tap(false, t0 + PAIR_MS); }
  return s.tap(false, t0 + CONFIRM_MS);
}

test("the measured rhythm arms, as two singles or one fused double", function() {
  [false, true].forEach(function(fused) {
    const s = createSequencer();
    assert.deepStrictEqual(password(s, 0, fused), { type: "echo" }, "fused=" + fused);
    assert.strictEqual(s.state(), "echo");
  });
});

test("a lone tap goes nowhere", function() {
  const s = createSequencer();
  assert.strictEqual(s.tap(false, 0), null);
  assert.strictEqual(s.state(), "half");
  assert.strictEqual(s.tick(600), null);
  assert.strictEqual(s.state(), "idle");
});

test("two taps too far apart are not a pair", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, 700);          // too late: this is a new first tap
  assert.strictEqual(s.state(), "half");
  assert.strictEqual(s.tap(false, 1400), null, "still no pair");
  assert.strictEqual(s.state(), "half");
});

test("a bounce off the first tap is ignored, the real pair still lands", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, 40);           // within pairMinMs: one knock ringing twice
  assert.strictEqual(s.state(), "half");
  s.tap(false, 230);
  assert.strictEqual(s.state(), "waiting");
});

test("a confirming tap too soon is part of the pair, a later one confirms", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, 230);
  assert.strictEqual(s.tap(false, 400), null, "170 ms later: still the pair");
  assert.strictEqual(s.state(), "waiting");
  assert.deepStrictEqual(s.tap(false, 930), { type: "echo" });
});

test("the wait expires silently", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, 230);
  assert.strictEqual(s.tick(1500), null);
  assert.strictEqual(s.state(), "waiting", "still inside the window");
  assert.strictEqual(s.tick(1800), null, "no buzz when it gives up");
  assert.strictEqual(s.state(), "idle");
});

test("another pair restarts the wait", function() {
  const s = createSequencer();
  password(s, 0, true);
  const s2 = createSequencer();
  s2.tap(true, 0);
  s2.tap(true, 800);          // changed their mind; the clock starts again
  assert.strictEqual(s2.state(), "waiting");
  assert.strictEqual(s2.tick(2000), null, "measured from the second pair");
  assert.strictEqual(s2.state(), "waiting");
  assert.deepStrictEqual(s2.tap(false, 1600), { type: "echo" });
});

test("severity counts singles as one and fused pairs as two", function() {
  const s = createSequencer();
  password(s, 0, true);
  s.armed(1600);
  s.tap(false, 2000);
  s.tap(true, 2300);
  s.tap(false, 2600);
  assert.strictEqual(s.count(), 4);
  assert.deepStrictEqual(s.tick(6600), { type: "done", severity: 4 });
  assert.strictEqual(s.state(), "idle");
});

test("severity is capped at five", function() {
  const s = createSequencer();
  s.armed(0);
  for (let i = 1; i <= 8; i++) s.tap(false, i * 250);
  assert.strictEqual(s.count(), 5);
});

test("each tap restarts the four second clock", function() {
  const s = createSequencer();
  s.armed(0);
  s.tap(false, 1000);
  assert.strictEqual(s.tick(4500), null, "3.5 s since the tap, not since arming");
  s.tap(false, 4600);
  assert.strictEqual(s.tick(8000), null);
  assert.deepStrictEqual(s.tick(8600), { type: "done", severity: 2 });
});

test("arming and tapping nothing cancels", function() {
  const s = createSequencer();
  s.armed(0);
  assert.deepStrictEqual(s.tick(4000), { type: "cancel" });
  assert.strictEqual(s.state(), "idle");
});

test("a very long count is cut off at the hard cap", function() {
  const s = createSequencer({ quietMs: 60000 });
  s.armed(0);
  s.tap(false, 1000);
  assert.deepStrictEqual(s.tick(20000), { type: "done", severity: 1 });
});

test("taps during the echo are ignored", function() {
  const s = createSequencer();
  password(s, 0, true);
  assert.strictEqual(s.tap(false, 1000), null);
  assert.strictEqual(s.state(), "echo");
  assert.strictEqual(s.count(), 0);
});
