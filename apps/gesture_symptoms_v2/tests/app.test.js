"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));

function src(rel) { return fs.readFileSync(path.resolve(__dirname, rel), "utf8"); }

function setup(t, files, engine) {
  const menus = [], uis = [], timers = [];
  const h = mock.install({
    files: files || {},
    E: { showMenu: function(m) { menus.push(m); return m; } },
    Bangle: { setUI: function(o) { uis.push(o); } }
  });
  if (engine) global.GSYM2 = Object.assign({
    settings: {}, state: "idle", count: 0, paused: false, dryRun: false,
    lastTap: null, taps: [], last: null, onUpdate: null
  }, engine);
  t.after(function() { h.restore(); delete global.GSYM2; });
  (0, eval)("(function(require, setInterval, clearInterval) { " + src("../app.js") + " })")(
    global.require,
    function(cb) { timers.push(cb); return timers.length; },
    function() {});
  return { h: h, menus: menus, uis: uis, timers: timers, last: function() { return menus[menus.length - 1]; } };
}

function settingsMenu(t, files) {
  const menus = [];
  const h = mock.install({ files: files, E: { showMenu: function(m) { menus.push(m); return m; } } });
  t.after(function() { h.restore(); });
  (0, eval)("(function(require) { return " + src("../settings.js") + "; })")(global.require)(function() {});
  return { h: h, menus: menus };
}

test("main menu shows the event count and whether detection is on", function(t) {
  const a = setup(t, { "gsym2.log.json": JSON.stringify([{ t: 1, s: 2 }, { t: 2, s: 4 }]) }, {});
  const m = a.last();
  assert.strictEqual(m[""].title, "Tap Log");
  assert.ok(m["Events (2)"], Object.keys(m).join("|"));
  assert.strictEqual(m["Detection"].value, "on");
});

test("detection shows 'off' when the engine isn't running", function(t) {
  const a = setup(t, {}, null);
  assert.strictEqual(a.last()["Detection"].value, "off");
});

test("live test runs the engine in dry-run mode and restores it on back", function(t) {
  const a = setup(t, {}, {});
  a.last()["Live test"]();
  assert.strictEqual(global.GSYM2.dryRun, true);
  assert.strictEqual(typeof global.GSYM2.onUpdate, "function");
  global.GSYM2.lastTap = { t: Date.now(), dir: "left", double: true, skipped: false };
  global.GSYM2.onUpdate();
  a.uis[a.uis.length - 1].back();
  assert.strictEqual(global.GSYM2.dryRun, false);
  assert.strictEqual(global.GSYM2.onUpdate, null);
});

test("live test draws every protocol state without blowing up", function(t) {
  const strings = [];
  const a = setup(t, {}, {});
  global.g.drawString = function(s) { strings.push(s); return this; };
  a.last()["Live test"]();
  ["half", "waiting", "echo", "counting"].forEach(function(state) {
    global.GSYM2.state = state;
    global.GSYM2.count = 2;
    global.GSYM2.onUpdate();
  });
  assert.ok(strings.includes("Tap again"), strings.join("|"));
  assert.ok(strings.includes("Now one tap"));
  assert.ok(strings.includes("Counting: 2"));
});

test("event log lists newest first and deletes on confirm", async function(t) {
  const log = [{ t: 1700000000, s: 2 }, { t: 1700000600, s: 5 }];
  const a = setup(t, { "gsym2.log.json": JSON.stringify(log) }, {});
  a.last()["Events (2)"]();
  const keys = Object.keys(a.last()).filter(function(k) { return /\/5/.test(k); });
  assert.deepStrictEqual(keys.map(function(k) { return k.trim().slice(-3); }), ["5/5", "2/5"]);
  a.last()[keys[0]]();
  await new Promise(setImmediate);
  const left = JSON.parse(a.h.storage.files["gsym2.log.json"]);
  assert.deepStrictEqual(left.map(function(e) { return e.s; }), [2]);
});

test("settings defaults: locked-only on, sleep pause off, 4s count timeout", function(t) {
  const s = settingsMenu(t, {});
  const m = s.menus[0];
  assert.strictEqual(m["Detection"].value, true);
  assert.strictEqual(m["Only if locked"].value, true);
  assert.strictEqual(m["Pause in sleep"].value, false, "3am logging works out of the box");
  assert.strictEqual(m["Count timeout"].format(m["Count timeout"].value), "4.0s");
  assert.strictEqual(m["Tap sens."].format(0), "default");
});

test("settings persist changes", function(t) {
  const s = settingsMenu(t, {});
  const m = s.menus[0];
  m["Tap sens."].onchange(0x30);
  m["Count timeout"].onchange(6);
  m["Only if locked"].onchange(false);
  m["Buzz deaf time"].onchange(0.5);
  const saved = JSON.parse(s.h.storage.files["gsym2.json"]);
  assert.deepStrictEqual([saved.tapSens, saved.quietMs, saved.onlyWhenLocked, saved.muteMs],
    [0x30, 6000, false, 500]);
});

test("widget is hidden without the engine and shows the count while counting", function(t) {
  const h = mock.install({});
  t.after(function() { h.restore(); delete global.GSYM2; });
  const strings = [];
  global.g.drawString = function(s) { strings.push(s); return this; };
  (0, eval)(src("../widget.js"));
  assert.strictEqual(global.WIDGETS.gsym2.width, 0);

  global.GSYM2 = { state: "counting", count: 3, last: null };
  (0, eval)(src("../widget.js"));
  const w = global.WIDGETS.gsym2;
  assert.strictEqual(w.width, 24);
  w.x = 150; w.y = 0;
  w.draw();
  assert.deepStrictEqual(strings, ["3"]);
});
