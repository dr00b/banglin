"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { createSequencer } = require(path.resolve(__dirname, "../../../lib/morse-protocol.js"));

// The user's measured rhythm: the two taps of the pair 230 ms apart, then the
// confirming tap 700 ms after that.
const PAIR_MS = 230, CONFIRM_MS = 930;

// Play the password, either as two singles or as one fused "double" event,
// then the silence after it. Returns what the silence produced.
function password(s, t0, fused) {
  if (fused) s.tap(true, t0);
  else { s.tap(false, t0); s.tap(false, t0 + PAIR_MS); }
  assert.strictEqual(s.tap(false, t0 + CONFIRM_MS), null, "no echo until the silence after");
  assert.strictEqual(s.state(), "confirm");
  return s.tick(t0 + CONFIRM_MS + 600);
}

// Feed evenly spaced taps, as a hand patting a back does.
function train(s, t0, n, every) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(s.tap(false, t0 + i * every));
    out.push(s.tick(t0 + i * every + every / 2));
  }
  return out.filter(Boolean);
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

// --- False positives ---------------------------------------------------

test("burping: steady pats at any pace never arm", function() {
  [250, 300, 400, 500, 600, 700, 800, 1000].forEach(function(every) {
    const s = createSequencer();
    assert.deepStrictEqual(train(s, 0, 30, every), [], "every " + every + " ms");
  });
});

test("three even taps are not dot-dot-pause-dot", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, 300);
  assert.strictEqual(s.tap(false, 600), null, "pause no longer than the pair");
  assert.strictEqual(s.state(), "idle");
  assert.strictEqual(s.rejected().reason, "rhythm");
});

test("the pause has to be clearly longer than the pair", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, 300);
  s.tap(false, 800);          // 500 ms pause, but under 2 x 300
  assert.strictEqual(s.state(), "idle");
  const ok = createSequencer();
  ok.tap(false, 0);
  ok.tap(false, 300);
  ok.tap(false, 900);         // 600 ms: twice the pair
  assert.strictEqual(ok.state(), "confirm");
});

test("a password has to start out of silence", function() {
  const s = createSequencer();
  s.tap(false, 0);            // the tail of something else
  s.tick(500);
  assert.strictEqual(s.state(), "idle");
  s.tap(false, 900);          // a perfect password, but only 900 ms later
  s.tap(false, 900 + PAIR_MS);
  s.tap(false, 900 + CONFIRM_MS);
  assert.strictEqual(s.tick(900 + CONFIRM_MS + 600), null);
  assert.strictEqual(s.state(), "idle");
  assert.strictEqual(s.rejected().reason, "busy");
});

test("taps the caller sat out still count as noise", function() {
  const s = createSequencer();
  s.heard(0);                 // e.g. during the cooldown after an event
  assert.strictEqual(s.tap(true, 500), null);
  assert.strictEqual(s.state(), "idle");
  assert.deepStrictEqual(password(s, 2000, true), { type: "echo" }, "fine once it's quiet");
});

test("a tap straight after the password cancels it", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, PAIR_MS);
  s.tap(false, CONFIRM_MS);
  assert.strictEqual(s.tap(false, CONFIRM_MS + 400), null, "the knocking went on");
  assert.strictEqual(s.state(), "idle");
  assert.strictEqual(s.rejected().reason, "after");
  assert.strictEqual(s.tick(CONFIRM_MS + 1000), null, "and no echo later");
});

test("a fused double in the middle of a sequence is noise", function() {
  const s = createSequencer();
  s.tap(true, 0);
  s.tap(true, 800);
  assert.strictEqual(s.state(), "idle");
  assert.strictEqual(s.rejected().reason, "rhythm");
});

test("two taps too far apart are not a pair", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, 500);
  assert.strictEqual(s.state(), "idle");
});

test("the caller can veto an attempt", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, PAIR_MS);
  s.reject("moving", 300);
  assert.strictEqual(s.state(), "idle");
  assert.deepStrictEqual(s.rejected(), { reason: "moving", t: 300 });
});

// --- The password itself ----------------------------------------------

test("a bounce off the first tap is ignored, the real pair still lands", function() {
  const s = createSequencer();
  s.tap(false, 0);
  s.tap(false, 40);           // within pairMinMs: one knock ringing twice
  assert.strictEqual(s.state(), "half");
  s.tap(false, 230);
  assert.strictEqual(s.state(), "waiting");
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

// --- Counting -----------------------------------------------------------

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

test("more than five taps is patting, not a count: cancelled at once", function() {
  const s = createSequencer();
  s.armed(0);
  const out = [];
  for (let i = 1; i <= 6; i++) out.push(s.tap(false, i * 250));
  assert.deepStrictEqual(out.slice(0, 5), [null, null, null, null, null], "five is fine");
  assert.deepStrictEqual(out[5], { type: "cancel" });
  assert.strictEqual(s.state(), "idle");
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
  assert.strictEqual(s.tap(false, 1600), null);
  assert.strictEqual(s.state(), "echo");
  assert.strictEqual(s.count(), 0);
});
