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

test("summarize returns trend=rising for rising pressure", function() {
  const log = droppingLog(1010, 1014, 3);
  const s = trend.summarize(log);
  assert.strictEqual(s.trend, "rising");
  assert.ok(s.dp3h != null && s.dp3h > 0);
});

test("summarize returns trend=steady for <1 hPa change", function() {
  const log = droppingLog(1013, 1012.6, 3);
  const s = trend.summarize(log);
  assert.strictEqual(s.trend, "steady");
});

test("summarize returns unknown for empty log", function() {
  const s = trend.summarize([]);
  assert.strictEqual(s.trend, "unknown");
  assert.strictEqual(s.p, null);
  assert.strictEqual(s.T, null);
});

test("detect returns no alerts for empty log", function() {
  const r = trend.detect({ log: [], now: nowMin() });
  assert.strictEqual(r.anyFired, false);
  assert.strictEqual(r.shouldBuzz, false);
});

test("detect returns no alerts when log has only one entry", function() {
  const r = trend.detect({
    log: [{ t: nowMin(), p: 1013, T: 18, h: null, pr: null }],
    now: nowMin()
  });
  assert.strictEqual(r.anyFired, false);
});

test("pressure alert uses custom threshold from settings", function() {
  // Drop of 2 hPa — fires at threshold 1.5, silent at threshold 3.0
  const log = droppingLog(1013, 1011, 3);

  const rFires = trend.detect({
    log, now: nowMin(),
    settings: { pressureDropHpa3h: 1.5 }
  });
  assert.ok(rFires.fired.includes("pressure"), "fires at lower threshold");

  const rSilent = trend.detect({
    log, now: nowMin(),
    settings: { pressureDropHpa3h: 3.0 }
  });
  assert.strictEqual(rSilent.fired.indexOf("pressure"), -1, "silent at higher threshold");
});

test("temperature alert uses custom threshold from settings", function() {
  const log = tempSwingLog(18, 24);  // 6 C swing

  const rFires = trend.detect({
    log, now: nowMin(),
    settings: { tempSwingC6h: 5.0 }
  });
  assert.ok(rFires.fired.includes("temperature"), "fires at lower threshold");

  const rSilent = trend.detect({
    log, now: nowMin(),
    settings: { tempSwingC6h: 8.0 }
  });
  assert.strictEqual(rSilent.fired.indexOf("temperature"), -1, "silent at higher threshold");
});

test("summarize exposes dp3h, dT6h, dh6h deltas", function() {
  const n = nowMin();
  const log = [];
  for (let i = 0; i <= 36; i++) {
    log.push({ t: n - (36 - i) * 10, p: 1013 - i * 0.1, T: 18 + i * 0.1, h: 40 + i * 0.3, pr: null });
  }
  const s = trend.summarize(log);
  assert.ok(s.dp3h != null, "dp3h present");
  assert.ok(s.dT6h != null, "dT6h present");
  assert.ok(s.dh6h != null, "dh6h present");
  assert.ok(s.dp3h < 0, "pressure dropped");
  assert.ok(s.dT6h > 0, "temperature rose");
});

test("precipNext3h returns null when forecast is empty", function() {
  assert.strictEqual(trend.precipNext3h(null, nowMin()), null);
  assert.strictEqual(trend.precipNext3h({}, nowMin()), null);
  assert.strictEqual(trend.precipNext3h({ hourly: { time: [] } }, nowMin()), null);
});

test("precipNext3h returns null when all entries are outside the 3h window", function() {
  const n = nowMin();
  const nowMs = n * 60000;
  const forecast = {
    hourly: {
      time: [new Date(nowMs - 3600000).toISOString()],  // 1h in the past
      precipitation: [5.0]
    }
  };
  assert.strictEqual(trend.precipNext3h(forecast, n), null);
});

test("precipNext3h returns max precip within 3h window", function() {
  const n = nowMin();
  const nowMs = n * 60000;
  const forecast = {
    hourly: {
      time: [
        new Date(nowMs + 30 * 60000).toISOString(),   // +30 min
        new Date(nowMs + 90 * 60000).toISOString(),   // +90 min
        new Date(nowMs + 150 * 60000).toISOString()   // +150 min
      ],
      precipitation: [0.5, 3.0, 1.2]
    }
  };
  assert.strictEqual(trend.precipNext3h(forecast, n), 3.0, "returns max");
});

test("no cooldown (lastAlertMin null) always allows buzz", function() {
  const log = droppingLog(1015, 1011.5, 3);
  const r = trend.detect({ log, now: nowMin(), lastAlertMin: null });
  assert.strictEqual(r.shouldBuzz, true, "buzzes when no prior alert");
});

test("latest returns null for empty log", function() {
  assert.strictEqual(trend.latest([]), null);
  assert.strictEqual(trend.latest(null), null);
});
