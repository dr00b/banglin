"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));
const S = require("./synth.js");
const counterLib = fs.readFileSync(path.resolve(__dirname, "../../../lib/gesture-counter.js"), "utf8");
const bootSrc = fs.readFileSync(path.resolve(__dirname, "../boot.js"), "utf8");

// Boot the engine with a controllable clock and captured timers.
function boot(t, opts) {
  opts = opts || {};
  const files = Object.assign({ "gsym.counter.js": counterLib }, opts.files || {});
  if (opts.settings) files["gsym.json"] = JSON.stringify(opts.settings);
  const buzzes = [], power = [];
  const h = mock.install({
    files: files,
    modules: opts.modules,
    Bangle: {
      buzz: function(ms) { buzzes.push(ms); return Promise.resolve(); },
      setOptions: function(o) { power.push(o); },
      setPollInterval: function(ms) { power.push({ poll: ms }); }
    }
  });
  const clock = { now: 1700000000000 };
  const realNow = Date.now;
  Date.now = function() { return clock.now; };
  const intervals = [], timeouts = [];
  const fakeSetInterval = function(cb, ms) { intervals.push({ cb: cb, ms: ms, live: true }); return intervals.length; };
  const fakeClearInterval = function(id) { if (intervals[id - 1]) intervals[id - 1].live = false; };
  const fakeSetTimeout = function(cb, ms) { timeouts.push({ cb: cb, ms: ms }); return timeouts.length; };
  t.after(function() {
    Date.now = realNow;
    h.restore();
    delete global.GSYM;
    delete global.gsymCounter;
  });
  (0, eval)("(function(require, Bangle, setInterval, clearInterval, setTimeout) { " + bootSrc + " })")(
    global.require, global.Bangle, fakeSetInterval, fakeClearInterval, fakeSetTimeout);

  return {
    h: h, clock: clock, buzzes: buzzes, power: power, intervals: intervals,
    log: function() { return h.storage.readJSON("gsym.log.json", 1) || []; },
    gesture: function(twists, o) {
      h.Bangle.emit("gesture", S.toGestureBuffer(S.toSamples(S.rollTrace(twists, o))));
    },
    // Stream accel samples at 12.5 Hz, then run the 250 ms tick until idle.
    accel: function(twists) {
      const samples = S.toSamples(S.rollTrace(twists, { leadMs: 300 }));
      for (const s of samples) {
        clock.now += S.SAMPLE_MS;
        h.Bangle.emit("accel", s);
      }
      for (let i = 0; i < 40 && global.GSYM.state === "counting"; i++) {
        clock.now += 250;
        intervals.filter(function(x) { return x.live && x.ms === 250; }).forEach(function(x) { x.cb(); });
      }
    }
  };
}

const AWAKE = { pauseInSleep: false };

test("does nothing when detection is disabled", function(t) {
  const b = boot(t, { settings: { enabled: false } });
  assert.strictEqual(global.GSYM, undefined);
  assert.strictEqual((b.h.listeners.gesture || []).length, 0);
});

test("rule trigger then three reverse twists logs severity 3", function(t) {
  const b = boot(t, { settings: AWAKE });
  assert.strictEqual(global.GSYM.hasModel, false);
  b.gesture([1, 1]);
  assert.strictEqual(global.GSYM.state, "counting");
  assert.strictEqual(b.buzzes[0], 60, "short buzz when armed");
  assert.strictEqual(b.h.listeners.accel.length, 1);

  b.accel([-1, -1, -1]);
  assert.strictEqual(global.GSYM.state, "idle");
  assert.strictEqual((b.h.listeners.accel || []).length, 0, "accel listener removed");
  const log = b.log();
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].s, 3);
  assert.strictEqual(log[0].src, "rule");
});

test("a non-trigger gesture does not start counting", function(t) {
  const b = boot(t, { settings: AWAKE });
  b.gesture([1]);
  assert.strictEqual(global.GSYM.state, "idle");
  assert.strictEqual(global.GSYM.lastMotion.twists, 1);
});

test("no reverse twists cancels without logging", function(t) {
  const b = boot(t, { settings: AWAKE });
  b.gesture([-1, -1]);
  b.accel([]);
  assert.strictEqual(global.GSYM.state, "idle");
  assert.strictEqual(b.log().length, 0);
  assert.strictEqual(b.buzzes[b.buzzes.length - 1], 300, "long buzz on cancel");
});

test("dry run (Live test) reports but does not log", function(t) {
  const b = boot(t, { settings: AWAKE });
  global.GSYM.dryRun = true;
  b.gesture([1, 1]);
  b.accel([-1, -1]);
  assert.strictEqual(b.log().length, 0);
  assert.deepStrictEqual([global.GSYM.last.severity, global.GSYM.last.dry], [2, true]);
});

test("paused engine (recording samples) ignores gestures", function(t) {
  const b = boot(t, { settings: AWAKE });
  global.GSYM.paused = true;
  b.gesture([1, 1]);
  assert.strictEqual(global.GSYM.state, "idle");
});

test("gestures right after an event are ignored (cooldown)", function(t) {
  const b = boot(t, { settings: AWAKE });
  b.gesture([1, 1]);
  b.accel([-1]);
  b.gesture([1, 1]);
  assert.strictEqual(global.GSYM.state, "idle");
  b.clock.now += 2500;
  b.gesture([1, 1]);
  assert.strictEqual(global.GSYM.state, "counting");
});

test("sleep window pauses detection", function(t) {
  const b = boot(t, { settings: { pauseInSleep: true, sleepStart: 0, sleepEnd: 86399999 } });
  b.gesture([1, 1]);
  assert.strictEqual(global.GSYM.state, "idle");
});

const WITH_MODEL = {
  modules: { tensorflow: {} },
  files: { ".tfmodel": "model-bytes", ".tfnames": "noise,trigger" }
};

test("with a TF model, the rule alone does not trigger", function(t) {
  const b = boot(t, Object.assign({ settings: AWAKE }, WITH_MODEL));
  assert.strictEqual(global.GSYM.hasModel, true);
  b.gesture([1, 1]);
  assert.strictEqual(global.GSYM.state, "idle");
});

test("TF 'trigger' above threshold counts in the gesture's direction", function(t) {
  const b = boot(t, Object.assign({ settings: AWAKE }, WITH_MODEL));
  b.gesture([-1, -1]);
  b.h.Bangle.emit("aiGesture", "trigger", [0.05, 0.95]);
  assert.strictEqual(global.GSYM.state, "counting");
  b.accel([1, 1, 1, 1]);
  const log = b.log();
  assert.deepStrictEqual([log[0].s, log[0].src], [4, "tf"]);
});

test("TF low confidence or other labels are ignored", function(t) {
  const b = boot(t, Object.assign({ settings: AWAKE }, WITH_MODEL));
  b.gesture([1, 1]);
  b.h.Bangle.emit("aiGesture", "trigger", [0.4, 0.6]);
  assert.strictEqual(global.GSYM.state, "idle");
  b.h.Bangle.emit("aiGesture", "noise", [0.9, 0.1]);
  assert.strictEqual(global.GSYM.state, "idle");
  assert.strictEqual(global.GSYM.lastTrigger.name, "noise");
});

test("detector 'rule' ignores an installed model", function(t) {
  boot(t, Object.assign({ settings: { pauseInSleep: false, detector: "rule" } }, WITH_MODEL));
  assert.strictEqual(global.GSYM.hasModel, false);
});

test("power-save is left alone by default", function(t) {
  const b = boot(t, { settings: AWAKE });
  assert.strictEqual(b.power.length, 0);
});

test("high accuracy keeps the accelerometer at 12.5 Hz while awake", function(t) {
  const b = boot(t, { settings: { pauseInSleep: false, highAccuracy: true } });
  assert.deepStrictEqual(b.power, [{ powerSave: false }, { poll: 80 }]);
});
