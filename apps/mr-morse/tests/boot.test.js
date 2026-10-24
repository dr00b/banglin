"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const harness = require(path.resolve(__dirname, "harness.js"));

// Boot the engine with a controllable clock and a timer queue we can drain.
function boot(t, opts) {
  const b = harness.boot(opts);
  t.after(b.restore);
  // The password at the user's own rhythm, then the silence after it and
  // the echo. Leaves the clock just past the mute, ready to count.
  b.password = function(fused) {
    if (fused) { b.tap(true); } else { b.tap(false); b.advance(230); b.tap(false); }
    b.advance(700);
    b.tap(false);
    b.advance(1800); // silence, echo plays, counting starts, mute expires
  };
  return b;
}

test("does nothing when detection is disabled", function(t) {
  const b = boot(t, { settings: { enabled: false } });
  assert.strictEqual(global.MORSE, undefined);
  assert.strictEqual((b.h.listeners.tap || []).length, 0);
});

test("the measured rhythm arms, counts three taps and logs severity 3", function(t) {
  const b = boot(t, {});
  b.password(false);
  assert.strictEqual(b.state(), "counting");
  assert.strictEqual(b.buzzes[0], 80, "short buzzes echo the password back");
  assert.strictEqual(b.buzzes.length, 3, "buzz-buzz, pause, buzz");

  b.tap(false);
  b.advance(250);
  b.tap(false);
  b.advance(250);
  b.tap(false);
  assert.strictEqual(global.MORSE.count, 3);
  b.advance(4400);
  assert.strictEqual(b.state(), "idle");
  const log = b.log();
  assert.strictEqual(log.length, 1);
  assert.deepStrictEqual([log[0].s, log[0].src], [3, "tap"]);
});

test("a chip-fused double arms it too, and counts as two", function(t) {
  const b = boot(t, {});
  b.password(true);
  b.tap(true);
  b.advance(300);
  b.tap(false);
  b.advance(4400);
  assert.strictEqual(b.log()[0].s, 3);
});

test("the echo's own buzz is not counted", function(t) {
  const b = boot(t, {});
  b.tap(false);
  b.advance(230);
  b.tap(false);
  b.advance(700);
  b.tap(false);          // password complete
  b.advance(900);        // the silence after it; the watch starts buzzing
  assert.ok(b.buzzes.length > 0, "echoing");
  b.tap(false);          // the motor shaking the accelerometer
  assert.strictEqual(global.MORSE.lastTap.skipped, true);
  b.advance(900);
  assert.strictEqual(global.MORSE.count, 0, "nothing counted from the buzz");
});

test("a lone tap leads nowhere and starts no event", function(t) {
  const b = boot(t, {});
  b.tap(false);
  b.advance(600);
  assert.strictEqual(b.state(), "idle");
  assert.strictEqual(b.buzzes.length, 0);
});

test("taps on the glass are left to the UI", function(t) {
  const b = boot(t, {});
  b.touch();
  b.tap(false);
  assert.strictEqual(global.MORSE.lastTap.skipped, true);
  assert.strictEqual(b.state(), "idle");
  b.advance(300); // past the touch veto
  b.tap(false);
  assert.strictEqual(global.MORSE.lastTap.skipped, false);
});

test("taps are ignored while the screen is unlocked", function(t) {
  const b = boot(t, { locked: false });
  b.tap(true);
  assert.strictEqual(global.MORSE.lastTap.skipped, true);
  assert.strictEqual(b.state(), "idle");
});

test("counting locks the screen and restores it afterwards", function(t) {
  const b = boot(t, { settings: { onlyWhenLocked: false }, locked: false });
  b.password(true);
  assert.deepStrictEqual(b.locks, [true], "locked while counting");
  b.advance(4400);
  assert.deepStrictEqual(b.locks, [true, false], "unlocked again when done");
});

test("arming and then tapping nothing logs nothing", function(t) {
  const b = boot(t, {});
  b.password(true);
  b.advance(4400);
  assert.strictEqual(b.log().length, 0);
  assert.strictEqual(b.buzzes[b.buzzes.length - 1], 300, "one long buzz on cancel");
});

test("more than five taps cancels instead of logging a five", function(t) {
  const b = boot(t, {});
  b.password(true);
  for (let i = 0; i < 7; i++) { b.tap(false); b.advance(250); }
  b.advance(4400);
  assert.strictEqual(b.log().length, 0);
  assert.strictEqual(b.buzzes[b.buzzes.length - 1], 300, "the cancel buzz");
});

test("burping: a minute of steady pats logs nothing", function(t) {
  const b = boot(t, {});
  [300, 450, 600, 800].forEach(function(every) {
    for (let i = 0; i < 60000 / every; i++) { b.tap(i % 7 === 3); b.advance(every); }
  });
  b.advance(10000);
  assert.strictEqual(b.log().length, 0);
  assert.strictEqual(b.buzzes.length, 0, "not even an echo");
});

test("a lone tap doesn't wake the accelerometer stream", function(t) {
  const b = boot(t, {});
  b.tap(false);
  b.advance(1000);
  assert.deepStrictEqual(b.power, []);
  assert.strictEqual(b.accelListeners(), 0);
});

test("a moving wrist is not tapping: dropped as soon as it's plain", function(t) {
  const b = boot(t, {});
  b.tap(false);
  b.advance(230);
  b.tap(false);
  assert.deepStrictEqual(b.power[0], ["poll", 80], "full-rate accel once a pair is in");
  assert.strictEqual(b.accelListeners(), 1);
  b.accel(6, 0.3);           // half a second of a swinging arm
  assert.strictEqual(b.state(), "idle", "gives up without waiting for a third tap");
  assert.strictEqual(global.MORSE.rejected.reason, "moving");
  assert.ok(global.MORSE.motion > 0.2);
  assert.strictEqual(b.accelListeners(), 0, "stopped listening");
  assert.deepStrictEqual(b.power[b.power.length - 1], ["options", { powerSave: true }]);
  b.advance(2000);
  assert.strictEqual(b.buzzes.length, 0);
});

test("a still wrist with a few tap spikes arms", function(t) {
  const b = boot(t, {});
  b.tap(false);
  b.advance(230);
  b.tap(false);
  b.accel(1, 0.4);           // the tap itself
  b.accel(7, 0.01);
  b.tap(false);
  b.accel(1, 0.4);
  b.accel(9, 0.01);
  b.advance(1000);
  assert.strictEqual(b.state(), "counting");
  assert.ok(global.MORSE.motion < 0.05);
  assert.strictEqual(b.accelListeners(), 0, "not listening while counting");
});

test("patting that stops: moving while the taps go in, still after, is dropped", function(t) {
  const b = boot(t, {});
  b.tap(true);               // the last pats, fused by the chip
  b.accel(5, 0.3);           // the arm still stroking
  b.advance(60);
  b.tap(false);
  b.accel(10, 0.01);         // ...then it stops, and stays still
  b.advance(1000);
  assert.strictEqual(b.state(), "idle");
  assert.strictEqual(global.MORSE.rejected.reason, "moving", "the still part doesn't outvote the moving part");
  assert.strictEqual(b.buzzes.length, 0);
});

test("the stillness check can be switched off", function(t) {
  const b = boot(t, { settings: { stillMax: 0 } });
  b.tap(false);
  assert.strictEqual(b.accelListeners(), 0);
  assert.deepStrictEqual(b.power, []);
  b.advance(230);
  b.tap(false);
  b.advance(700);
  b.tap(false);
  b.advance(1800);
  assert.strictEqual(b.state(), "counting");
});

test("taps right after an event are ignored (cooldown)", function(t) {
  const b = boot(t, {});
  b.password(true);
  b.tap(false);
  b.advance(4400);
  b.tap(true);
  assert.strictEqual(global.MORSE.lastTap.skipped, true);
  b.advance(3200);
  b.tap(true);
  assert.strictEqual(b.state(), "waiting");
});

test("dry run (Live test) reports but does not log", function(t) {
  const b = boot(t, {});
  global.MORSE.dryRun = true;
  b.password(true);
  b.tap(false);
  b.advance(4400);
  assert.strictEqual(b.log().length, 0);
  assert.deepStrictEqual([global.MORSE.last.severity, global.MORSE.last.dry], [1, true]);
});

test("the sleep window is off by default, so 3am still logs", function(t) {
  const b = boot(t, { settings: { sleepStart: 0, sleepEnd: 86399999 } });
  b.password(true);
  b.tap(false);
  b.advance(4400);
  assert.strictEqual(b.log().length, 1);
});

test("the sleep window pauses detection when switched on", function(t) {
  const b = boot(t, { settings: { pauseInSleep: true, sleepStart: 0, sleepEnd: 86399999 } });
  b.tap(true);
  assert.strictEqual(global.MORSE.lastTap.skipped, true);
  assert.strictEqual(b.state(), "idle");
});

test("the accelerometer's tap threshold is only written when configured", function(t) {
  const b = boot(t, {});
  assert.deepStrictEqual(b.writes, []);
  const c = boot(t, { settings: { tapSens: 0x30 } });
  assert.deepStrictEqual(c.writes, [[0x18, 0x00], [0x1E, 0x3F], [0x27, 0x30], [0x18, 0x84]]);
});

test("no timer runs while nothing is happening", function(t) {
  const b = boot(t, {});
  assert.strictEqual(b.timers.filter((x) => x.live).length, 0, "idle at boot");
  b.password(true);
  b.tap(false);
  assert.ok(b.timers.some((x) => x.live && x.interval), "ticking while counting");
  b.advance(4400);
  assert.strictEqual(b.state(), "idle");
  assert.strictEqual(b.timers.filter((x) => x.live && x.interval).length, 0, "stopped again");
});

test("every tap is kept for the Live test, accepted or not", function(t) {
  const b = boot(t, {});
  b.touch();
  b.tap(false);          // vetoed by the touch
  b.advance(300);
  b.tap(false);
  b.advance(230);
  b.tap(false);
  assert.deepStrictEqual(global.MORSE.taps.map((x) => x.skipped), [true, false, false]);
  for (let i = 0; i < 20; i++) { b.advance(600); b.tap(false); }
  assert.strictEqual(global.MORSE.taps.length, 16, "oldest fall off");
});

test("the Live test works on an unlocked screen, but still ignores glass pokes", function(t) {
  const b = boot(t, { locked: false });
  global.MORSE.dryRun = true;
  b.password(true);
  assert.strictEqual(b.state(), "counting", "the diagnostic screen can arm it");
  assert.deepStrictEqual(b.locks, [], "and does not lock the screen you are watching");
  b.touch();
  b.tap(false);
  assert.strictEqual(global.MORSE.lastTap.skipped, true, "a poke at the glass is still not a tap");
});

test("protocol constants can be tuned from morse.json", function(t) {
  const b = boot(t, { settings: { pairMaxMs: 200 } });
  b.tap(false);
  b.advance(230);
  b.tap(false);              // fine by default, too slow for this user's own tuning
  assert.strictEqual(b.state(), "idle");
  assert.strictEqual(global.MORSE.rejected.reason, "rhythm");
});

test("the widget is only redrawn when what it shows changes", function(t) {
  const b = boot(t, {});
  for (let i = 0; i < 60; i++) { b.tap(false); b.advance(400); }   // half a minute of patting
  b.advance(5000);
  assert.ok(b.m.draws <= 4, b.m.draws + " redraws for 60 pats");
});

test("a field-test recording in progress keeps counts out of the event log", function(t) {
  const b = boot(t, {});
  global.MORSE.recording = true;
  b.password(true);
  b.tap(false);
  b.advance(4400);
  assert.deepStrictEqual(b.metrics().done, [1], "counted");
  assert.strictEqual(b.log().length, 0, "not logged");
});
