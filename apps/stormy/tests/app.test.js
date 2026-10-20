"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));
const trendLib = fs.readFileSync(path.resolve(__dirname, "../../../lib/pressure-trend.js"), "utf8");

function nowMin() { return 1000000; }

function flatLog(baseP, baseT) {
  var log = [];
  var n = nowMin();
  for (var i = 0; i < 24; i++) {
    log.push({ t: n - (23 - i) * 60, p: baseP || 1013, T: baseT || 18, h: null, pr: null });
  }
  return log;
}

function loadApp(overrides) {
  const src = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
  const wrapped = "(function(require, Bangle, E, g, BTN, setWatch, load, WIDGETS, setTimeout) { " + src + " })";
  (0, eval)(wrapped)(
    global.require, global.Bangle, global.E, global.g,
    global.BTN, global.setWatch, global.load, global.WIDGETS,
    global.setTimeout
  );
}

// ---------------------------------------------------------------------------
// showMenu structure
// ---------------------------------------------------------------------------

test("showMenu title is 'Stormy' when no alert pending", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify(flatLog()),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  assert.ok(captured, "menu was displayed");
  assert.strictEqual(captured[""].title, "Stormy");
});

test("showMenu title includes '!' when alert is pending", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: true }),
      "stormy.log.json": JSON.stringify(flatLog()),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  assert.ok(captured[""].title.includes("!"), "alert indicator in title");
});

test("showMenu pressure row shows '--' when log is empty", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify([]),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  const pressureKey = Object.keys(captured).find(function(k) { return k.startsWith("P "); });
  assert.ok(pressureKey, "pressure row exists");
  assert.ok(pressureKey.includes("--"), "shows '--' for null pressure");
});

test("showMenu pressure row shows reading when data available", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false, usePhoneForecast: false }),
      "stormy.log.json": JSON.stringify(flatLog(1013.5)),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  const pressureKey = Object.keys(captured).find(function(k) { return k.startsWith("P "); });
  assert.ok(pressureKey && pressureKey.includes("1013.5"), "pressure reading in key: " + pressureKey);
});

test("showMenu delta value uses '+' prefix for positive change", function(t) {
  const n = nowMin();
  var log = [];
  for (var i = 0; i < 24; i++) {
    log.push({ t: n - (23 - i) * 60, p: 1010 + i * 0.25, T: 18, h: null, pr: null });
  }
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify(log),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  const pressureKey = Object.keys(captured).find(function(k) { return k.startsWith("P "); });
  assert.ok(pressureKey, "pressure row exists");
  const val = captured[pressureKey].value;
  assert.ok(typeof val === "string" && val.startsWith("+"), "positive delta has '+' prefix: " + val);
});

test("showMenu RH row hidden when usePhoneForecast is false", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false, usePhoneForecast: false }),
      "stormy.log.json": JSON.stringify(flatLog()),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  const rhKey = Object.keys(captured).find(function(k) { return k.startsWith("RH "); });
  assert.strictEqual(rhKey, undefined, "RH row hidden when phone forecast off");
});

test("showMenu RH row visible when usePhoneForecast is true and humidity available", function(t) {
  const n = nowMin();
  var log = [];
  for (var i = 0; i < 24; i++) {
    log.push({ t: n - (23 - i) * 60, p: 1013, T: 18, h: 50 + i, pr: null });
  }
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false, usePhoneForecast: true }),
      "stormy.log.json": JSON.stringify(log),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  const rhKey = Object.keys(captured).find(function(k) { return k.startsWith("RH "); });
  assert.ok(rhKey, "RH row visible when phone forecast on");
});

test("showMenu 'Dismiss alert' row appears only when alertPending", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: true }),
      "stormy.log.json": JSON.stringify(flatLog()),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  assert.ok(captured["Dismiss alert"], "dismiss row present when alertPending");
});

test("showMenu has no 'Dismiss alert' when alertPending is false", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify(flatLog()),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  assert.strictEqual(captured["Dismiss alert"], undefined, "no dismiss row when no alert");
});

// ---------------------------------------------------------------------------
// dismissAlert behaviour
// ---------------------------------------------------------------------------

test("dismissAlert clears alertPending in storage", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: true }),
      "stormy.log.json": JSON.stringify(flatLog()),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  const menus = [];
  global.E.showMenu = function(m) { menus.push(m); return m; };
  global.E.showMessage = function() {};

  loadApp();

  menus[0]["Dismiss alert"]();

  return new Promise(function(resolve) {
    setTimeout(function() {
      const saved = JSON.parse(h.storage.files["stormy.json"]);
      assert.strictEqual(saved.alertPending, false, "alertPending cleared in storage");
      resolve();
    }, 100);
  });
});

test("dismissAlert triggers widget redraw when WIDGETS.stormy exists", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: true }),
      "stormy.log.json": JSON.stringify(flatLog()),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  const menus = [];
  global.E.showMenu = function(m) { menus.push(m); return m; };
  global.E.showMessage = function() {};

  var widgetDrawn = false;
  global.WIDGETS.stormy = { draw: function() { widgetDrawn = true; } };

  loadApp();
  menus[0]["Dismiss alert"]();

  assert.strictEqual(widgetDrawn, true, "widget redrawn after dismiss");
});

// ---------------------------------------------------------------------------
// showTrendGraph
// ---------------------------------------------------------------------------

test("showTrendGraph shows 'Not enough data' when log has fewer than 2 entries", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify([{ t: nowMin(), p: 1013, T: 18, h: null, pr: null }]),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  const menus = [];
  global.E.showMenu = function(m) { menus.push(m); return m; };

  const strings = [];
  global.g.drawString = function(s) { strings.push(s); };

  loadApp();
  menus[0]["View graph"]();

  assert.ok(strings.some(function(s) { return s === "Not enough data"; }),
    "insufficient data message drawn");
});

test("showTrendGraph draws a line for each log segment when data exists", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify(flatLog(1013)),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  const menus = [];
  global.E.showMenu = function(m) { menus.push(m); return m; };

  var lineCount = 0;
  global.g.drawLine = function() { lineCount++; };

  loadApp();
  menus[0]["View graph"]();

  assert.ok(lineCount >= 1, "at least one line segment drawn for chart: got " + lineCount);
});

test("showTrendGraph draws pressure axis labels", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify(flatLog(1013)),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  const menus = [];
  global.E.showMenu = function(m) { menus.push(m); return m; };

  const strings = [];
  global.g.drawString = function(s) { strings.push(s); };

  loadApp();
  menus[0]["View graph"]();

  const hpaLabels = strings.filter(function(s) { return typeof s === "string" && s.includes("hPa"); });
  assert.ok(hpaLabels.length >= 2, "min and max hPa labels drawn: " + JSON.stringify(hpaLabels));
});

// ---------------------------------------------------------------------------
// testBuzz
// ---------------------------------------------------------------------------

test("testBuzz calls Bangle.buzz and then shows menu again", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify(flatLog()),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  const menus = [];
  global.E.showMenu = function(m) { menus.push(m); return m; };
  global.E.showMessage = function() {};

  var buzzed = false;
  global.Bangle.buzz = function() { buzzed = true; return Promise.resolve(); };

  loadApp();
  menus[0]["Test buzz"]();

  return new Promise(function(resolve) {
    setTimeout(function() {
      assert.strictEqual(buzzed, true, "Bangle.buzz called");
      resolve();
    }, 50);
  });
});

// ---------------------------------------------------------------------------
// Trend display in menu
// ---------------------------------------------------------------------------

test("showMenu trend row shows 'falling' for dropping pressure log", function(t) {
  const n = nowMin();
  var log = [];
  for (var i = 0; i < 24; i++) {
    // 0.5 hPa/h drop => 1.5 hPa over 3h, which exceeds the summarize <=−1 threshold
    log.push({ t: n - (23 - i) * 60, p: 1015 - i * 0.5, T: 18, h: null, pr: null });
  }
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify(log),
      "stormy.trend.js": trendLib
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  loadApp();

  assert.strictEqual(captured["Trend"].value, "falling");
});

test("showMenu falls back gracefully when trend.js is missing", function(t) {
  const h = mock.install({
    files: {
      "stormy.json": JSON.stringify({ enabled: true, alertPending: false }),
      "stormy.log.json": JSON.stringify(flatLog())
      // no stormy.trend.js
    }
  });
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  assert.doesNotThrow(function() { loadApp(); }, "no throw when trend.js absent");
  assert.ok(captured, "menu still rendered");
  assert.strictEqual(captured["Trend"].value, "--");
});
