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
  if (engine) global.MORSE = Object.assign({
    settings: {}, state: "idle", count: 0, paused: false, dryRun: false,
    lastTap: null, taps: [], last: null, onUpdate: null
  }, engine);
  t.after(function() { h.restore(); delete global.MORSE; });
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
  const a = setup(t, { "morse.log.json": JSON.stringify([{ t: 1, s: 2 }, { t: 2, s: 4 }]) }, {});
  const m = a.last();
  assert.strictEqual(m[""].title, "Mr Morse");
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
  assert.strictEqual(global.MORSE.dryRun, true);
  assert.strictEqual(typeof global.MORSE.onUpdate, "function");
  global.MORSE.lastTap = { t: Date.now(), dir: "left", double: true, skipped: false };
  global.MORSE.onUpdate();
  a.uis[a.uis.length - 1].back();
  assert.strictEqual(global.MORSE.dryRun, false);
  assert.strictEqual(global.MORSE.onUpdate, null);
});

test("live test draws every protocol state without blowing up", function(t) {
  const strings = [];
  const a = setup(t, {}, {});
  global.g.drawString = function(s) { strings.push(s); return this; };
  a.last()["Live test"]();
  ["half", "waiting", "confirm", "echo", "counting"].forEach(function(state) {
    global.MORSE.state = state;
    global.MORSE.count = 2;
    global.MORSE.onUpdate();
  });
  assert.ok(strings.includes("Tap again"), strings.join("|"));
  assert.ok(strings.includes("Now one tap"));
  assert.ok(strings.includes("Hold still"));
  assert.ok(strings.includes("Counting: 2"));
  global.MORSE.state = "idle";
  global.MORSE.rejected = { reason: "moving", t: Date.now() };
  global.MORSE.motion = 0.25;
  global.MORSE.lastTap = { t: Date.now(), dir: "left", double: false, skipped: false };
  global.MORSE.onUpdate();
  assert.ok(strings.includes("Wrist moving"), "says why it was thrown away");
  assert.ok(strings.includes("left single move 0.25"), strings.join("|"));
});

test("live test says why a tap was ignored", function(t) {
  const strings = [];
  const a = setup(t, {}, {});
  global.g.drawString = function(s) { strings.push(s); return this; };
  a.last()["Live test"]();
  global.MORSE.lastTap = { t: Date.now(), dir: "front", double: false, skipped: true, why: "cooldown" };
  global.MORSE.rejected = { reason: "direction", t: Date.now() };
  global.MORSE.onUpdate();
  assert.ok(strings.includes("front single - cooldown"), strings.join("|"));
  assert.ok(strings.includes("Wrong direction"));
});

// --- Field test ---------------------------------------------------------

function fieldSetup(t, files) {
  return setup(t, Object.assign({ "morse.rec.js": src("../recorder.js") }, files || {}), {});
}

test("field test: starting a session writes its header and marker and starts recording", async function(t) {
  const a = fieldSetup(t);
  a.last()["Field test"]();
  const m = a.last();
  m["Session"].onchange(m["Session"].max - 5);           // password-seated
  m["Severity"].onchange(2);
  m["Attempts"].onchange(4);
  m["Start"]();
  await new Promise(setImmediate);
  const marker = JSON.parse(a.h.storage.files["morse.rec.json"]);
  assert.strictEqual(marker.label, "password-seated");
  const header = JSON.parse(a.h.storage.files[marker.file].split("\n")[0].slice(1));
  assert.deepStrictEqual([header.label, header.expect, header.severity, header.attempts, header.minutes],
    ["password-seated", "logs", 2, 4, 10]);
  assert.strictEqual(global.MORSE.recording, true);
  assert.strictEqual(typeof global.MORSE.trace, "function");
  assert.ok(a.last()["Field test"], "back at the main menu");
});

test("field test: an everyday session expects silence; stop ends it", async function(t) {
  const a = fieldSetup(t);
  a.last()["Field test"]();
  a.last()["Start"]();                                     // the first session: burp-pat
  await new Promise(setImmediate);
  const marker = JSON.parse(a.h.storage.files["morse.rec.json"]);
  const header = JSON.parse(a.h.storage.files[marker.file].split("\n")[0].slice(1));
  assert.deepStrictEqual([header.label, header.expect, header.severity], ["burp-pat", "silent", undefined]);
  a.last()["Field test"]();
  const m = a.last();
  assert.strictEqual(m["burp-pat"].value, "10 min left");
  m["Stop now"]();
  assert.strictEqual(a.h.storage.files["morse.rec.json"], undefined, "marker removed");
  assert.strictEqual(global.MORSE.recording, false);
  assert.ok(/^s,\d+$/m.test(a.h.storage.files[marker.file]), "stop line written");
});

test("field test: the Live test is refused while recording", async function(t) {
  const alerts = [];
  const a = fieldSetup(t);
  global.E.showAlert = function(msg) { alerts.push(msg); return Promise.resolve(); };
  a.last()["Field test"]();
  a.last()["Start"]();
  await new Promise(setImmediate);
  a.last()["Live test"]();
  assert.ok(alerts.some(function(x) { return /Stop the field test/.test(x); }), alerts.join("|"));
  assert.strictEqual(global.MORSE.dryRun, false);
});

test("field test: recordings are listed by session and can be deleted", async function(t) {
  const files = { "morse.rabc.csv": "#" + JSON.stringify({ label: "typing", minutes: 5 }) + "\na,1,0,0,-1000,2\n" };
  const a = fieldSetup(t, files);
  a.last()["Field test"]();
  a.last()["Recordings (1)"]();
  const m = a.last();
  assert.ok(m["typing 5m"], Object.keys(m).join("|"));
  m["typing 5m"]();
  await new Promise(setImmediate);
  assert.strictEqual(a.h.storage.files["morse.rabc.csv"], undefined);
});

test("event log lists newest first and deletes on confirm", async function(t) {
  const log = [{ t: 1700000000, s: 2 }, { t: 1700000600, s: 5 }];
  const a = setup(t, { "morse.log.json": JSON.stringify(log) }, {});
  a.last()["Events (2)"]();
  const keys = Object.keys(a.last()).filter(function(k) { return /\/5/.test(k); });
  assert.deepStrictEqual(keys.map(function(k) { return k.trim().slice(-3); }), ["5/5", "2/5"]);
  a.last()[keys[0]]();
  await new Promise(setImmediate);
  const left = JSON.parse(a.h.storage.files["morse.log.json"]);
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

test("tap direction defaults to any and saves the one chosen", function(t) {
  const s = settingsMenu(t, {});
  const m = s.menus[0];
  assert.strictEqual(m["Tap direction"].format(m["Tap direction"].value), "any");
  assert.strictEqual(m["Still wrist"].format(m["Still wrist"].value), "<0.10g");
  m["Tap direction"].onchange(2);
  assert.strictEqual(JSON.parse(s.h.storage.files["morse.json"]).tapDir, "back");
});

test("settings persist changes", function(t) {
  const s = settingsMenu(t, {});
  const m = s.menus[0];
  m["Tap sens."].onchange(0x30);
  m["Count timeout"].onchange(6);
  m["Only if locked"].onchange(false);
  m["Buzz deaf time"].onchange(0.5);
  const saved = JSON.parse(s.h.storage.files["morse.json"]);
  assert.deepStrictEqual([saved.tapSens, saved.quietMs, saved.onlyWhenLocked, saved.muteMs],
    [0x30, 6000, false, 500]);
});

test("widget is hidden without the engine and shows the count while counting", function(t) {
  const h = mock.install({});
  t.after(function() { h.restore(); delete global.MORSE; });
  const strings = [];
  global.g.drawString = function(s) { strings.push(s); return this; };
  (0, eval)(src("../widget.js"));
  assert.strictEqual(global.WIDGETS.morse.width, 0);

  global.MORSE = { state: "counting", count: 3, last: null };
  (0, eval)(src("../widget.js"));
  const w = global.WIDGETS.morse;
  assert.strictEqual(w.width, 24);
  w.x = 150; w.y = 0;
  w.draw();
  assert.deepStrictEqual(strings, ["3"]);
});
