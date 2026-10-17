"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));
const counterLib = fs.readFileSync(path.resolve(__dirname, "../../../lib/gesture-counter.js"), "utf8");

function src(rel) { return fs.readFileSync(path.resolve(__dirname, rel), "utf8"); }

function setup(t, files, engine) {
  const menus = [], uis = [], timers = [];
  const h = mock.install({
    files: Object.assign({ "gsym.counter.js": counterLib }, files || {}),
    E: { showMenu: function(m) { menus.push(m); return m; } },
    Bangle: { setUI: function(o) { uis.push(o); } }
  });
  if (engine) global.GSYM = Object.assign({
    settings: { enterDeg: 35 }, state: "idle", count: 0, hasModel: false,
    paused: false, dryRun: false, onUpdate: null
  }, engine);
  t.after(function() { h.restore(); delete global.GSYM; delete global.gsymCounter; });
  (0, eval)("(function(require, setInterval, clearInterval) { " + src("../app.js") + " })")(
    global.require,
    function(cb, ms) { timers.push(cb); return timers.length; },
    function() {});
  return { h: h, menus: menus, uis: uis, last: function() { return menus[menus.length - 1]; } };
}

function settingsMenu(t, files) {
  const menus = [];
  const h = mock.install({ files: files, E: { showMenu: function(m) { menus.push(m); return m; } } });
  t.after(function() { h.restore(); });
  (0, eval)("(function(require) { return " + src("../settings.js") + "; })")(global.require)(function() {});
  return { h: h, menus: menus };
}

test("main menu shows event count and detector", function(t) {
  const a = setup(t, { "gsym.log.json": JSON.stringify([{ t: 1, s: 2 }, { t: 2, s: 4 }]) }, {});
  const m = a.last();
  assert.strictEqual(m[""].title, "Gesture Log");
  assert.ok(m["Events (2)"], Object.keys(m).join("|"));
  assert.strictEqual(m["Detector"].value, "rule");
});

test("detector shows 'off' when the engine isn't running", function(t) {
  const a = setup(t, {}, null);
  assert.strictEqual(a.last()["Detector"].value, "off");
});

test("recording appends labelled gesture rows and pauses the engine", function(t) {
  const a = setup(t, {}, {});
  a.last()["Record samples"]();
  assert.ok(a.last()["trigger (0)"]);
  a.last()["trigger (0)"]();
  assert.strictEqual(global.GSYM.paused, true);
  a.h.Bangle.emit("gesture", new Int8Array([1, 2, -64, 3, 4, -60]));
  a.h.Bangle.emit("gesture", new Int8Array([5, 6, -64]));
  assert.strictEqual(a.h.storage.files["gsym.samples.csv"], "trigger,2,1,2,-64,3,4,-60\ntrigger,1,5,6,-64\n");

  a.uis[a.uis.length - 1].back();
  assert.strictEqual(global.GSYM.paused, false, "engine resumed");
  assert.strictEqual((a.h.listeners.gesture || []).length, 0, "listener removed");
  assert.ok(a.last()["trigger (2)"], "count updated: " + Object.keys(a.last()).join("|"));
});

test("live test runs the engine in dry-run mode and restores it on back", function(t) {
  const a = setup(t, {}, {});
  a.last()["Live test"]();
  assert.strictEqual(global.GSYM.dryRun, true);
  assert.strictEqual(typeof global.GSYM.onUpdate, "function");
  a.h.Bangle.emit("accel", { x: 0, y: 0.5, z: -0.8 });
  global.GSYM.onUpdate();
  a.uis[a.uis.length - 1].back();
  assert.strictEqual(global.GSYM.dryRun, false);
  assert.strictEqual(global.GSYM.onUpdate, null);
  assert.strictEqual((a.h.listeners.accel || []).length, 0);
});

test("event log lists newest first and deletes on confirm", async function(t) {
  const log = [{ t: 1700000000, s: 2 }, { t: 1700000600, s: 5 }];
  const a = setup(t, { "gsym.log.json": JSON.stringify(log) }, {});
  a.last()["Events (2)"]();
  const keys = Object.keys(a.last()).filter(function(k) { return /\/5/.test(k); });
  assert.deepStrictEqual(keys.map(function(k) { return k.trim().slice(-3); }), ["5/5", "2/5"]);
  a.last()[keys[0]]();
  await new Promise(setImmediate);
  const left = JSON.parse(a.h.storage.files["gsym.log.json"]);
  assert.deepStrictEqual(left.map(function(e) { return e.s; }), [2]);
});

test("duplicate timestamps still get distinct menu rows", function(t) {
  const log = [{ t: 1700000000, s: 3 }, { t: 1700000000, s: 3 }];
  const a = setup(t, { "gsym.log.json": JSON.stringify(log) }, {});
  a.last()["Events (2)"]();
  assert.strictEqual(Object.keys(a.last()).filter(function(k) { return /3\/5/.test(k); }).length, 2);
});

test("settings defaults: rule/TF auto, 35 degrees, power-save kept", function(t) {
  const s = settingsMenu(t, {});
  const m = s.menus[0];
  assert.strictEqual(m["Detection"].value, true);
  assert.strictEqual(m["Detector"].format(m["Detector"].value), "Auto");
  assert.strictEqual(m["Twist angle"].value, 35);
  assert.strictEqual(m["High accuracy"].value, false);
  assert.strictEqual(m["Pause in sleep"].value, true);
});

test("settings persist changes", function(t) {
  const s = settingsMenu(t, {});
  const m = s.menus[0];
  m["Detector"].onchange(1);
  m["TF confidence"].onchange(90);
  m["Count timeout"].onchange(2.5);
  const saved = JSON.parse(s.h.storage.files["gsym.json"]);
  assert.deepStrictEqual([saved.detector, saved.tfThreshold, saved.quietMs], ["rule", 0.9, 2500]);
});

test("widget is hidden without the engine and shows the count while counting", function(t) {
  const h = mock.install({});
  t.after(function() { h.restore(); delete global.GSYM; });
  const strings = [];
  global.g.drawString = function(s) { strings.push(s); return this; };
  (0, eval)(src("../widget.js"));
  assert.strictEqual(global.WIDGETS.gsym.width, 0);

  global.GSYM = { state: "counting", count: 3, last: null };
  (0, eval)(src("../widget.js"));
  const w = global.WIDGETS.gsym;
  assert.strictEqual(w.width, 24);
  w.x = 150; w.y = 0;
  w.draw();
  assert.deepStrictEqual(strings, ["3"]);
});
