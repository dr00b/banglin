"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const trend = require(path.resolve(__dirname, "../../../lib/pressure-trend.js"));

function nowMin() { return 1000000; }

function flatLog(base) {
  var log = [];
  var n = nowMin();
  for (var i = 0; i < 24; i++) {
    log.push({ t: n - (23 - i) * 60, p: base, T: 18, h: null, pr: null });
  }
  return log;
}

function droppingLog(startP, endP, hours) {
  var log = [];
  var n = nowMin();
  var steps = hours * 6;
  for (var i = 0; i <= steps; i++) {
    var p = startP + (endP - startP) * (i / steps);
    log.push({ t: n - (steps - i) * 10, p: p, T: 18, h: null, pr: null });
  }
  return log;
}

function tempSwingLog(startT, endT) {
  var log = [];
  var n = nowMin();
  for (var i = 0; i <= 36; i++) {
    var T = startT + (endT - startT) * (i / 36);
    log.push({ t: n - (36 - i) * 10, p: 1013, T: T, h: null, pr: null });
  }
  return log;
}

function humidLog(startH, endH, hoursBack) {
  var log = [];
  var n = nowMin();
  var steps = hoursBack * 6;
  for (var i = 0; i <= steps; i++) {
    var h = startH + (endH - startH) * (i / steps);
    log.push({ t: n - (steps - i) * 10, p: 1013, T: 18, h: h, pr: 0 });
  }
  return log;
}

test("flat buffer produces no alert", function() {
  const log = flatLog(1013);
  const r = trend.detect({ log: log, now: nowMin() });
  assert.strictEqual(r.anyFired, false);
  assert.deepStrictEqual(r.fired, []);
});

test("3 hPa drop across 3 h fires pressure alert (onboard only)", function() {
  const log = droppingLog(1015, 1011.5, 3);
  const r = trend.detect({ log: log, now: nowMin() });
  assert.ok(r.fired.indexOf("pressure") >= 0, "pressure should fire: " + JSON.stringify(r));
  assert.strictEqual(r.shouldBuzz, true);
});

test("small pressure drop below threshold does not fire", function() {
  const log = droppingLog(1013, 1012, 3);
  const r = trend.detect({ log: log, now: nowMin() });
  assert.strictEqual(r.fired.indexOf("pressure"), -1);
});

test("6 C swing across 6 h fires temperature alert", function() {
  const log = tempSwingLog(20, 27);
  const r = trend.detect({ log: log, now: nowMin() });
  assert.ok(r.fired.indexOf("temperature") >= 0, JSON.stringify(r));
});

test("humidity jump fires when usePhoneForecast is ON", function() {
  const log = humidLog(40, 65, 6);
  const r = trend.detect({
    log: log, now: nowMin(),
    settings: { usePhoneForecast: true }
  });
  assert.ok(r.fired.indexOf("humidity") >= 0, JSON.stringify(r));
});

test("humidity jump is IGNORED when usePhoneForecast is OFF", function() {
  const log = humidLog(40, 65, 6);
  const r = trend.detect({ log: log, now: nowMin() });
  assert.strictEqual(r.fired.indexOf("humidity"), -1);
});

test("precipitation trigger fires with forecast", function() {
  const n = nowMin();
  const nowMs = n * 60000;
  const forecast = {
    hourly: {
      time: [
        new Date(nowMs + 30 * 60000).toISOString(),
        new Date(nowMs + 90 * 60000).toISOString(),
        new Date(nowMs + 150 * 60000).toISOString()
      ],
      precipitation: [0, 2.5, 0.5]
    }
  };
  const r = trend.detect({
    log: flatLog(1013), now: n,
    settings: { usePhoneForecast: true },
    forecast: forecast
  });
  assert.ok(r.fired.indexOf("precipitation") >= 0, JSON.stringify(r));
});

test("precipitation trigger is IGNORED when usePhoneForecast is OFF", function() {
  const n = nowMin();
  const nowMs = n * 60000;
  const forecast = {
    hourly: {
      time: [new Date(nowMs + 30 * 60000).toISOString()],
      precipitation: [10]
    }
  };
  const r = trend.detect({
    log: flatLog(1013), now: n,
    forecast: forecast
  });
  assert.strictEqual(r.fired.indexOf("precipitation"), -1);
});

test("alert within cooldown is suppressed", function() {
  const log = droppingLog(1015, 1011.5, 3);
  const n = nowMin();
  const r = trend.detect({
    log: log, now: n,
    lastAlertMin: n - 60,
    settings: { cooldownH: 6 }
  });
  assert.ok(r.anyFired, "still detects the condition");
  assert.strictEqual(r.shouldBuzz, false, "but should not buzz during cooldown");
});

test("alert after cooldown passes does buzz", function() {
  const log = droppingLog(1015, 1011.5, 3);
  const n = nowMin();
  const r = trend.detect({
    log: log, now: n,
    lastAlertMin: n - 60 * 7,
    settings: { cooldownH: 6 }
  });
  assert.strictEqual(r.shouldBuzz, true);
});

test("summarize returns trend=falling for pressure drop", function() {
  const log = droppingLog(1015, 1011, 3);
  const s = trend.summarize(log);
  assert.strictEqual(s.trend, "falling");
  assert.ok(s.dp3h != null && s.dp3h < 0);
});
