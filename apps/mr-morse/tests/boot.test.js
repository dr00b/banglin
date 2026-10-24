"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));
const tapLib = fs.readFileSync(path.resolve(__dirname, "../../../lib/morse-protocol.js"), "utf8");
const bootSrc = fs.readFileSync(path.resolve(__dirname, "../boot.js"), "utf8");

// Boot the engine with a controllable clock and a timer queue we can drain.
function boot(t, opts) {
  opts = opts || {};
  const files = Object.assign({ "morse.tapseq.js": tapLib }, opts.files || {});
  if (opts.settings) files["morse.json"] = JSON.stringify(opts.settings);
  const buzzes = [], writes = [], locks = [], power = [];
  let locked = opts.locked === undefined ? true : opts.locked;
  const h = mock.install({
    files: files,
    Bangle: {
      buzz: function(ms) { buzzes.push(ms); return Promise.resolve(); },
      isLocked: function() { return locked; },
      setLocked: function(v) { locked = v; locks.push(v); },
      accelRd: function() { return 0x80; },
      accelWr: function(reg, data) { writes.push([reg, data]); },
      setPollInterval: function(ms) { power.push(["poll", ms]); },
      setOptions: function(o) { power.push(["options", o]); }
    }
  });

  const clock = { now: 1700000000000 };
  const realNow = Date.now;
  Date.now = function() { return clock.now; };
  const timers = [];
  const add = (cb, ms, interval) => timers.push({ due: clock.now + ms, ms: ms, cb: cb, interval: interval, live: true });
  const fakeSetTimeout = function(cb, ms) {
    const args = Array.prototype.slice.call(arguments, 2);
    return add(function() { cb.apply(null, args); }, ms || 0, false);
  };
  const fakeSetInterval = function(cb, ms) { return add(cb, ms, true); };
  const fakeClear = function(id) { if (timers[id - 1]) timers[id - 1].live = false; };

  t.after(function() {
    Date.now = realNow;
    h.restore();
    delete global.MORSE;
    delete global.morseTap;
  });

  (0, eval)("(function(require, Bangle, setInterval, clearInterval, setTimeout) { " + bootSrc + " })")(
    global.require, global.Bangle, fakeSetInterval, fakeClear, fakeSetTimeout);

  // Run every timer due up to now+ms, in order, moving the clock as we go.
  function advance(ms) {
    const target = clock.now + ms;
    for (;;) {
      let next = null;
      for (const x of timers) if (x.live && x.due <= target && (!next || x.due < next.due)) next = x;
      if (!next) break;
      clock.now = next.due;
      if (next.interval) next.due += next.ms; else next.live = false;
      next.cb();
    }
    clock.now = target;
  }

  return {
    h: h, clock: clock, buzzes: buzzes, writes: writes, locks: locks, timers: timers, power: power,
    advance: advance,
    setLocked: function(v) { locked = v; },
    tap: function(double, dir) { h.Bangle.emit("tap", { dir: dir || "left", double: !!double }); },
    touch: function() { h.Bangle.emit("touch", 1); },
    // n accelerometer samples 80 ms apart, each changing by diff g.
    accel: function(n, diff) {
      for (let i = 0; i < n; i++) { h.Bangle.emit("accel", { diff: diff }); advance(80); }
    },
    accelListeners: function() { return (h.listeners.accel || []).length; },
    state: function() { return global.MORSE.state; },
    log: function() { return h.storage.readJSON("morse.log.json", 1) || []; },
    // The password at the user's own rhythm, then the silence after it and
    // the echo. Leaves the clock just past the mute, ready to count.
    password: function(fused) {
      if (fused) { this.tap(true); } else { this.tap(false); advance(230); this.tap(false); }
      advance(700);
      this.tap(false);
      advance(1800); // silence, echo plays, counting starts, mute expires
    }
  };
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

test("a moving wrist is not tapping: the password is dropped", function(t) {
  const b = boot(t, {});
  b.tap(false);
  assert.deepStrictEqual(b.power[0], ["poll", 80], "full-rate accel while deciding");
  assert.strictEqual(b.accelListeners(), 1);
  b.accel(3, 0.3);
  b.tap(false);
  b.accel(9, 0.3);
  b.tap(false);
  b.accel(8, 0.3);
  b.advance(1000);
  assert.strictEqual(b.state(), "idle");
  assert.strictEqual(b.buzzes.length, 0);
  assert.strictEqual(global.MORSE.rejected.reason, "moving");
  assert.ok(global.MORSE.motion > 0.2);
  assert.strictEqual(b.accelListeners(), 0, "stopped listening");
  assert.deepStrictEqual(b.power[b.power.length - 1], ["options", { powerSave: true }]);
});

test("a still wrist with a few tap spikes arms", function(t) {
  const b = boot(t, {});
  b.tap(false);
  b.accel(1, 0.4);           // the tap itself
  b.accel(2, 0.01);
  b.tap(false);
  b.accel(1, 0.4);
  b.accel(8, 0.01);
  b.tap(false);
  b.accel(1, 0.4);
  b.accel(7, 0.01);
  b.advance(1000);
  assert.strictEqual(b.state(), "counting");
  assert.ok(global.MORSE.motion < 0.05);
  assert.strictEqual(b.accelListeners(), 0, "not listening while counting");
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
