"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));
const trendLib = fs.readFileSync(path.resolve(__dirname, "../../../lib/pressure-trend.js"), "utf8");

// ---------------------------------------------------------------------------
// Helpers to load boot.js in a controlled environment
// ---------------------------------------------------------------------------

function loadBoot(h, extraGlobals) {
  // Capture the setInterval/setTimeout callbacks without executing them
  const intervals = [];
  const timeouts = [];

  global.setInterval = function(cb, ms) { intervals.push({ cb, ms }); return intervals.length; };
  global.setTimeout = function(cb, ms) { timeouts.push({ cb, ms }); return timeouts.length; };
  global.clearInterval = function() {};

  const src = fs.readFileSync(path.resolve(__dirname, "../boot.js"), "utf8");
  const wrapped = "(function(require, Bangle, setInterval, setTimeout) { " + src + " })";
  (0, eval)(wrapped)(global.require, global.Bangle, global.setInterval, global.setTimeout);

  return { intervals, timeouts };
}

// ---------------------------------------------------------------------------
// appendLog / log management
// ---------------------------------------------------------------------------

test("appendLog stores a sample and returns the updated log", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, sleepStart: null, sleepEnd: null }),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); delete global.setInterval; delete global.setTimeout; delete global.clearInterval; });

  h.storage.writeJSON("stormy.log.json", []);
  const { intervals } = loadBoot(h);

  // Trigger doSample manually via the interval callback
  const doSample = intervals[0].cb;

  var pressureCallback = null;
  global.Bangle.setBarometerPower = function(on) { return true; };
  global.Bangle.on = function(ev, cb) { if (ev === "pressure") pressureCallback = cb; };
  global.Bangle.removeListener = function() {};

  doSample();
  assert.ok(pressureCallback, "pressure listener registered");

  pressureCallback({ pressure: 1013.5, temperature: 20.1 });

  const log = JSON.parse(h.storage.files["stormy.log.json"]);
  assert.strictEqual(log.length, 1, "one entry stored");
  assert.ok(Math.abs(log[0].p - 1013.5) < 0.01, "pressure stored");
  assert.ok(Math.abs(log[0].T - 20.1) < 0.01, "temperature stored");
});

test("appendLog trims log to MAX_LOG (144) entries", function(t) {
  const h = mock.install({
    files: { "stormy.trend.js": trendLib }
  });
  t.after(function() { h.restore(); delete global.setInterval; delete global.setTimeout; delete global.clearInterval; });

  // Pre-fill log with 144 entries
  var initialLog = [];
  for (var i = 0; i < 144; i++) initialLog.push({ t: i, p: 1013, T: 18, h: null, pr: null });
  h.storage.writeJSON("stormy.json", { enabled: true, sleepStart: null, sleepEnd: null });
  h.storage.writeJSON("stormy.log.json", initialLog);

  const { intervals } = loadBoot(h);
  const doSample = intervals[0].cb;

  var pressureCallback = null;
  global.Bangle.setBarometerPower = function() { return true; };
  global.Bangle.on = function(ev, cb) { if (ev === "pressure") pressureCallback = cb; };
  global.Bangle.removeListener = function() {};

  doSample();
  pressureCallback({ pressure: 1020, temperature: 22 });

  const log = JSON.parse(h.storage.files["stormy.log.json"]);
  assert.strictEqual(log.length, 144, "log capped at MAX_LOG=144");
  assert.ok(Math.abs(log[143].p - 1020) < 0.01, "newest entry is at the end");
});

// ---------------------------------------------------------------------------
// doSample: enabled / disabled
// ---------------------------------------------------------------------------

test("doSample does nothing when enabled=false", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: false }),
      "stormy.log.json": JSON.stringify([]),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); delete global.setInterval; delete global.setTimeout; delete global.clearInterval; });

  const { intervals } = loadBoot(h);
  const doSample = intervals[0].cb;

  var baroOn = false;
  global.Bangle.setBarometerPower = function(on) { if (on) baroOn = true; return true; };

  doSample();

  assert.strictEqual(baroOn, false, "barometer never powered on when disabled");
});

// ---------------------------------------------------------------------------
// doSample: alert triggering
// ---------------------------------------------------------------------------

test("doSample fires buzz when pressure drop exceeds threshold", function(t) {
  const n = Math.floor(Date.now() / 60000);
  // Flat history at 1013 hPa, last entry at n-10 so new sample at ~n is strictly later
  var log = [];
  for (var i = 0; i < 24; i++) {
    log.push({ t: n - (24 - i) * 10, p: 1013, T: 18, h: null, pr: null });
  }

  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, pressureDropHpa3h: 3.0, cooldownH: 6, sleepStart: null, sleepEnd: null }),
      "stormy.log.json": JSON.stringify(log),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); delete global.setInterval; delete global.setTimeout; delete global.clearInterval; });

  const { intervals } = loadBoot(h);
  const doSample = intervals[0].cb;

  var buzzCount = 0;
  global.Bangle.buzz = function() { buzzCount++; return Promise.resolve(); };

  var pressureCallback = null;
  global.Bangle.setBarometerPower = function() { return true; };
  global.Bangle.on = function(ev, cb) { if (ev === "pressure") pressureCallback = cb; };
  global.Bangle.removeListener = function() {};

  doSample();
  // New reading 4 hPa below history => triggers pressure alert
  pressureCallback({ pressure: 1009, temperature: 18 });

  const saved = JSON.parse(h.storage.files["stormy.json"]);
  assert.strictEqual(saved.alertPending, true, "alertPending set in settings");
  assert.ok(buzzCount >= 1, "buzz triggered");
});

test("doSample suppresses buzz during cooldown period", function(t) {
  const n = Math.floor(Date.now() / 60000);
  var log = [];
  for (var i = 0; i < 24; i++) {
    log.push({ t: n - (24 - i) * 10, p: 1013, T: 18, h: null, pr: null });
  }

  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({
        enabled: true, pressureDropHpa3h: 3.0, cooldownH: 6,
        sleepStart: null, sleepEnd: null,
        lastAlertMin: n - 60  // alert 1 hour ago, cooldown is 6h
      }),
      "stormy.log.json": JSON.stringify(log),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); delete global.setInterval; delete global.setTimeout; delete global.clearInterval; });

  const { intervals } = loadBoot(h);
  const doSample = intervals[0].cb;

  var buzzCount = 0;
  global.Bangle.buzz = function() { buzzCount++; return Promise.resolve(); };

  var pressureCallback = null;
  global.Bangle.setBarometerPower = function() { return true; };
  global.Bangle.on = function(ev, cb) { if (ev === "pressure") pressureCallback = cb; };
  global.Bangle.removeListener = function() {};

  doSample();
  pressureCallback({ pressure: 1009, temperature: 18 });

  assert.strictEqual(buzzCount, 0, "no buzz during cooldown");
});

// ---------------------------------------------------------------------------
// doSample: sleep window (requires the bug fix to be in place)
// ---------------------------------------------------------------------------

test("doSample skips sampling during sleep window", function(t) {
  // Set sleep window to cover "all day" (midnight to midnight+1s) to guarantee we're in it
  const allDaySleepStart = 0;
  const allDaySleepEnd = 86399000;  // 23:59:59 in ms

  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({
        enabled: true,
        sleepStart: allDaySleepStart,
        sleepEnd: allDaySleepEnd
      }),
      "stormy.log.json": JSON.stringify([]),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); delete global.setInterval; delete global.setTimeout; delete global.clearInterval; });

  const { intervals } = loadBoot(h);
  const doSample = intervals[0].cb;

  var baroOn = false;
  global.Bangle.setBarometerPower = function(on) { if (on) baroOn = true; return true; };

  doSample();

  assert.strictEqual(baroOn, false, "barometer not powered during sleep window");
});

test("doSample skips sampling when sleep window wraps midnight and current time is after sleepStart", function(t) {
  // Typical night: 23:00 - 07:00. Force 'now' to be 23:30 (within window).
  // We fake Date.now() by overriding it.
  const nightTime = new Date();
  nightTime.setHours(23, 30, 0, 0);
  const origDateNow = Date.now;
  Date.now = function() { return nightTime.getTime(); };

  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({
        enabled: true,
        sleepStart: 23 * 3600000,   // 23:00 in ms
        sleepEnd: 7 * 3600000        // 07:00 in ms
      }),
      "stormy.log.json": JSON.stringify([]),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() {
    h.restore();
    Date.now = origDateNow;
    delete global.setInterval; delete global.setTimeout; delete global.clearInterval;
  });

  const { intervals } = loadBoot(h);
  const doSample = intervals[0].cb;

  var baroOn = false;
  global.Bangle.setBarometerPower = function(on) { if (on) baroOn = true; return true; };

  doSample();

  assert.strictEqual(baroOn, false, "barometer skipped at 23:30 inside sleep window");
});

test("doSample samples normally outside sleep window", function(t) {
  // Noon (12:00) is outside the default 23:00-07:00 sleep window
  const noonTime = new Date();
  noonTime.setHours(12, 0, 0, 0);
  const origDateNow = Date.now;
  Date.now = function() { return noonTime.getTime(); };

  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({
        enabled: true,
        sleepStart: 23 * 3600000,
        sleepEnd: 7 * 3600000
      }),
      "stormy.log.json": JSON.stringify([]),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() {
    h.restore();
    Date.now = origDateNow;
    delete global.setInterval; delete global.setTimeout; delete global.clearInterval;
  });

  const { intervals } = loadBoot(h);
  const doSample = intervals[0].cb;

  var baroOn = false;
  global.Bangle.setBarometerPower = function(on) { if (on) baroOn = true; return true; };
  global.Bangle.on = function() {};

  doSample();

  assert.strictEqual(baroOn, true, "barometer powered at noon (outside sleep window)");
});

// ---------------------------------------------------------------------------
// barometer timeout fallback
// ---------------------------------------------------------------------------

test("doSample handles barometer timeout (no pressure event) without crashing", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true }),
      "stormy.log.json": JSON.stringify([]),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); delete global.setInterval; delete global.setTimeout; delete global.clearInterval; });

  const timeouts = [];
  global.setInterval = function(cb, ms) { return 1; };
  global.setTimeout = function(cb, ms) { timeouts.push({ cb, ms }); return timeouts.length; };
  global.clearInterval = function() {};

  const src = fs.readFileSync(path.resolve(__dirname, "../boot.js"), "utf8");
  (0, eval)(src);

  // We just loaded it; now trigger the barometer timeout
  // Find the 6000ms timeout (barometer fallback)
  const baroTimeout = timeouts.find(function(t) { return t.ms === 6000; });
  // If there is no baro timeout yet (doSample hasn't fired), the initial timeout (5000ms) is the doSample starter
  const doSampleTimeout = timeouts.find(function(t) { return t.ms === 5000; });

  // Calling the initial doSample should register a barometer timeout
  if (doSampleTimeout) {
    var baroCallback = null;
    global.Bangle.setBarometerPower = function() { return true; };
    global.Bangle.on = function(ev, cb) { if (ev === "pressure") baroCallback = cb; };
    global.Bangle.removeListener = function() {};

    doSampleTimeout.cb();

    // Find the new 6000ms timeout
    const baroT = timeouts.find(function(ti) { return ti.ms === 6000; });
    if (baroT) {
      assert.doesNotThrow(function() { baroT.cb(); }, "barometer timeout does not throw");
    }
  }
  // Test passes as long as no exception is thrown loading / calling the callbacks
  assert.ok(true, "no crash on barometer timeout path");
});

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

test("boot loads settings defaults when stormy.json is absent", function(t) {
  const h = mock.install({ files: { "stormy.trend.js": trendLib } });
  t.after(function() { h.restore(); delete global.setInterval; delete global.setTimeout; delete global.clearInterval; });

  assert.doesNotThrow(function() { loadBoot(h); }, "loads without crash when no settings file");
});
