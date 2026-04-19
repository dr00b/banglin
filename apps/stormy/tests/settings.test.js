"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));

function readSettings(storage) {
  return JSON.parse(storage.files["stormy.json"]);
}

function loadSettingsFactory() {
  const src = fs.readFileSync(path.resolve(__dirname, "../settings.js"), "utf8");
  const wrapped = "(function(require, Bangle, E, Object, Promise, setTimeout) { return " + src + "; })";
  return (0, eval)(wrapped)(
    global.require, global.Bangle, global.E, Object, Promise, setTimeout
  );
}

test("settings defaults load when file is absent", function(t) {
  const h = mock.install();
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  const factory = loadSettingsFactory();
  factory(function() {});

  assert.ok(captured, "menu was rendered");
  assert.strictEqual(captured[""].title, "Stormy");
  assert.strictEqual(captured["Enabled"].value, true);
  assert.strictEqual(captured["P drop hPa/3h"].value, 3.0);
  assert.strictEqual(captured["T swing C/6h"].value, 6.0);
  assert.strictEqual(captured["Use phone fcst"].value, false);
  assert.strictEqual(captured["RH jump %/6h"], undefined,
    "humidity threshold hidden when forecast toggle is off");
});

test("toggling enabled persists via Storage.writeJSON", function(t) {
  const h = mock.install();
  t.after(function() { h.restore(); });

  var captured = null;
  global.E.showMenu = function(m) { captured = m; return m; };

  const factory = loadSettingsFactory();
  factory(function() {});

  captured["Enabled"].onchange(false);
  var s = readSettings(h.storage);
  assert.strictEqual(s.enabled, false);

  captured["P drop hPa/3h"].onchange(4.5);
  s = readSettings(h.storage);
  assert.strictEqual(s.pressureDropHpa3h, 4.5);
});

test("enabling usePhoneForecast reveals forecast-only fields on next render", function(t) {
  const h = mock.install();
  t.after(function() { h.restore(); });

  const renders = [];
  global.E.showMenu = function(m) { renders.push(m); return m; };

  const factory = loadSettingsFactory();
  factory(function() {});

  renders[0]["Use phone fcst"].onchange(true);

  return new Promise(function(resolve) {
    setTimeout(function() {
      const latest = renders[renders.length - 1];
      assert.ok(latest["RH jump %/6h"], "humidity row revealed");
      assert.ok(latest["Precip mm/3h"], "precipitation row revealed");
      assert.ok(latest["Location"], "location revealed");
      resolve();
    }, 30);
  });
});
