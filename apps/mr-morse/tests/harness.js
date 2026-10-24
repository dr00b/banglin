"use strict";

// Runs morse.boot.js in node against a mocked Bangle with a controllable
// clock, feeds it events, and measures what it decided and what that cost.
// Shared by the engine tests, the simulation suite and the field-recording
// replays, so all three exercise exactly the code that runs on the watch.

const path = require("node:path");
const fs = require("node:fs");
const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));
const power = require(path.resolve(__dirname, "../../../tests/helpers/power-model.js"));

const APP = path.resolve(__dirname, "..");
const SOURCES = {
  "morse.tapseq.js": fs.readFileSync(path.resolve(APP, "../../lib/morse-protocol.js"), "utf8"),
  "morse.rec.js": fs.readFileSync(path.join(APP, "recorder.js"), "utf8")
};
const BOOT = fs.readFileSync(path.join(APP, "boot.js"), "utf8");
const START = 1700000000000;

// opts: settings, files, locked (default true), start (wall-clock ms),
// motor (an rng: the buzz motor shakes out spurious taps, as on the watch).
function boot(opts) {
  opts = opts || {};
  const files = Object.assign({}, SOURCES, opts.files || {});
  if (opts.settings) files["morse.json"] = JSON.stringify(opts.settings);
  const start = opts.start || START;
  const clock = { now: start };
  let locked = opts.locked === undefined ? true : opts.locked;
  let powerSave = true, fastSince = null, buzzUntil = 0;
  const m = {
    buzzes: [], writes: [], locks: [], power: [], decisions: [],
    flash: 0, logWrites: 0, draws: 0, taps: 0, accel: 0, timerFires: 0,
    fastMs: 0, accelMs: 0, accelSince: null, boots: 0
  };
  const eListeners = {};

  const h = mock.install({
    files: files,
    E: {
      on: function(ev, cb) { (eListeners[ev] = eListeners[ev] || []).push(cb); },
      emit: function(ev) { (eListeners[ev] || []).slice().forEach(function(cb) { cb(); }); }
    },
    Bangle: {
      buzz: function(ms) {
        ms = ms || 200;
        m.buzzes.push(ms);
        buzzUntil = Math.max(buzzUntil, clock.now + ms);
        if (opts.motor) motorTaps(ms);
        // Resolves when the buzz ends, on the fake clock.
        return { then: function(cb) { add(cb, ms, false); } };
      },
      isLocked: function() { return locked; },
      setLocked: function(v) { locked = v; m.locks.push(v); },
      accelRd: function() { return 0x80; },
      accelWr: function(reg, data) { m.writes.push([reg, data]); },
      getOptions: function() { return { powerSave: powerSave }; },
      setPollInterval: function(ms) {
        m.power.push(["poll", ms]);
        if (powerSave) { powerSave = false; fastSince = clock.now; }
      },
      setOptions: function(o) {
        m.power.push(["options", o]);
        if (o.powerSave && !powerSave) { powerSave = true; m.fastMs += clock.now - fastSince; fastSince = null; }
      }
    }
  });
  global.WIDGETS.morse = { draw: function() { m.draws++; } };

  // Time spent with anything listening to the accelerometer stream.
  const on = h.Bangle.on, off = h.Bangle.removeListener;
  const accelCount = function() { return (h.listeners.accel || []).length; };
  h.Bangle.on = function(ev, cb) {
    if (ev === "accel" && !accelCount()) m.accelSince = clock.now;
    return on.call(this, ev, cb);
  };
  h.Bangle.removeListener = function(ev, cb) {
    off.call(this, ev, cb);
    if (ev === "accel" && !accelCount() && m.accelSince !== null) {
      m.accelMs += clock.now - m.accelSince;
      m.accelSince = null;
    }
  };

  // Flash writes: whole files and StorageFile appends.
  const st = h.storage;
  ["write", "writeJSON"].forEach(function(k) {
    const f = st[k];
    st[k] = function(name) {
      m.flash++;
      if (name === "morse.log.json") m.logWrites++;
      return f.apply(st, arguments);
    };
  });
  const open = st.open;
  st.open = function() {
    const file = open.apply(st, arguments), w = file.write;
    file.write = function() { m.flash++; return w.apply(file, arguments); };
    return file;
  };

  // Date.now() and new Date() follow the fake clock.
  const RealDate = global.Date;
  global.Date = class extends RealDate {
    constructor() {
      if (arguments.length) super(...arguments);
      else super(clock.now);
    }
    static now() { return clock.now; }
  };

  // Timer queue on the fake clock. Timers the harness itself schedules
  // (motor taps) are not counted as the engine's work.
  const timers = [];
  const add = function(cb, ms, interval, internal) {
    timers.push({ due: clock.now + ms, ms: ms, cb: cb, interval: interval, live: true, internal: !!internal, born: clock.now });
    return timers.length;
  };
  const fakeSetTimeout = function(cb, ms) {
    const args = Array.prototype.slice.call(arguments, 2);
    return add(function() { cb.apply(null, args); }, ms || 0, false);
  };
  const fakeSetInterval = function(cb, ms) { return add(cb, ms, true); };
  const fakeClear = function(id) {
    const x = timers[id - 1];
    if (x && x.live) { x.live = false; x.died = clock.now; }
  };

  function motorTaps(ms) {
    const r = opts.motor;
    if (r.chance(0.7)) add(function() { emitTap(r.chance(0.2), "front"); }, r.range(10, 40), false, true);
    if (r.chance(0.3)) add(function() { emitTap(false, "front"); }, ms + r.range(0, 30), false, true);
  }

  function emitTap(double, dir) {
    m.taps++;
    h.Bangle.emit("tap", { dir: dir || "left", double: !!double });
  }

  // Load the engine, as the watch does at every app load. A reboot first
  // tears the old one down: listeners and timers die with the old app.
  function load() {
    m.boots++;
    delete global.MORSE;
    (0, eval)("(function(require, Bangle, E, setInterval, clearInterval, setTimeout) { " + BOOT + " })")(
      global.require, global.Bangle, global.E, fakeSetInterval, fakeClear, fakeSetTimeout);
    const GS = global.MORSE;
    if (!GS) return;
    // Collect every decision, while still passing them on to whoever (the
    // recorder) installs a trace hook of its own.
    let inner = GS.trace;
    Object.defineProperty(GS, "trace", {
      get: function() {
        return function(kind, arg) {
          m.decisions.push({ t: clock.now - start, kind: kind, arg: arg });
          if (inner) inner(kind, arg);
        };
      },
      set: function(f) { inner = f; },
      configurable: true
    });
  }

  function reboot(state) {
    h.E.emit("kill");
    if (m.accelSince !== null) { m.accelMs += clock.now - m.accelSince; m.accelSince = null; }
    Object.keys(h.listeners).forEach(function(k) { delete h.listeners[k]; });
    Object.keys(eListeners).forEach(function(k) { delete eListeners[k]; });
    timers.forEach(function(x) { if (x.live) { x.live = false; x.died = clock.now; } });
    if (state && state.locked !== undefined) locked = state.locked;
    load();
  }

  // Run every timer due up to the target time, in order, moving the clock.
  function advanceTo(target) {
    for (;;) {
      let next = null;
      for (const x of timers) if (x.live && x.due <= target && (!next || x.due < next.due)) next = x;
      if (!next) break;
      clock.now = next.due;
      if (next.interval) next.due += next.ms;
      else { next.live = false; next.died = clock.now; }
      if (!next.internal) m.timerFires++;
      next.cb();
    }
    clock.now = Math.max(clock.now, target);
  }

  function advance(ms) { advanceTo(clock.now + ms); }

  // One event from a simulated timeline or a recording; e.t is ms since start.
  function dispatch(e) {
    if (e.type === "tap") emitTap(e.double, e.dir);
    else if (e.type === "accel") {
      const n = accelCount();
      if (!n) return;
      m.accel += n;
      const shake = clock.now < buzzUntil ? 0.3 : 0;
      h.Bangle.emit("accel", { x: e.x, y: e.y, z: e.z, diff: e.diff + shake, mag: e.mag });
    } else if (e.type === "lock") {
      locked = e.locked;
      h.Bangle.emit("lock", e.locked);
    } else if (e.type === "touch") h.Bangle.emit("touch", 1);
    else if (e.type === "boot") reboot(e);
  }

  function run(events, settleMs) {
    for (const e of events) {
      advanceTo(start + e.t);
      dispatch(e);
    }
    advance(settleMs === undefined ? 10000 : settleMs);
  }

  function count(kind) { return m.decisions.filter(function(d) { return d.kind === kind; }).length; }

  // Every logged count with when it was logged and when the echo that armed
  // it played, so a test can tell which attempt (if any) it belongs to.
  function logged() {
    let echoAt = null;
    const out = [];
    m.decisions.forEach(function(d) {
      if (d.kind === "echo") echoAt = d.t;
      else if (d.kind === "done") out.push({ t: d.t, severity: d.arg, echoAt: echoAt });
    });
    return out;
  }

  // What the session decided and what it cost.
  function metrics() {
    const durationMs = clock.now - start;
    const fastMs = m.fastMs + (fastSince !== null ? clock.now - fastSince : 0);
    const accelMs = m.accelMs + (m.accelSince !== null ? clock.now - m.accelSince : 0);
    const rejects = {};
    m.decisions.filter(function(d) { return d.kind === "reject"; })
      .forEach(function(d) { rejects[d.arg] = (rejects[d.arg] || 0) + 1; });
    const liveIntervals = timers.filter(function(x) { return x.live && x.interval && x.ms < 60000; }).length;
    return {
      durationMs: durationMs,
      echoes: count("echo"),
      done: m.decisions.filter(function(d) { return d.kind === "done"; }).map(function(d) { return d.arg; }),
      logged: logged(),
      cancels: count("cancel"),
      rejects: rejects,
      motionSessions: count("mon"),
      buzzes: m.buzzes.length,
      buzzMs: m.buzzes.reduce(function(a, b) { return a + b; }, 0),
      logWrites: m.logWrites,
      flash: m.flash,
      taps: m.taps,
      accel: m.accel,
      timerFires: m.timerFires,
      draws: m.draws,
      fastMs: fastMs,
      accelMs: accelMs,
      // Back to rest: nothing listening, no tick running, power-save back on.
      atRest: !accelCount() && !liveIntervals && powerSave &&
        (!global.MORSE || global.MORSE.state === "idle"),
      power: power.estimate({ taps: m.taps, accel: m.accel, timers: m.timerFires, draws: m.draws, fastMs: fastMs }, durationMs)
    };
  }

  function restore() {
    global.Date = RealDate;
    h.restore();
    delete global.MORSE;
    delete global.morseTap;
  }

  load();

  return {
    h: h, clock: clock, m: m, timers: timers, start: start,
    buzzes: m.buzzes, writes: m.writes, locks: m.locks, power: m.power,
    advance: advance, advanceTo: advanceTo, dispatch: dispatch, run: run, reboot: reboot,
    metrics: metrics, restore: restore,
    setLocked: function(v) { locked = v; },
    tap: emitTap,
    touch: function() { h.Bangle.emit("touch", 1); },
    // n accelerometer samples 80 ms apart, each changing by diff g.
    accel: function(n, diff) {
      for (let i = 0; i < n; i++) { dispatch({ type: "accel", x: 0, y: 0, z: -1, diff: diff, mag: 1 }); advance(80); }
    },
    accelListeners: accelCount,
    state: function() { return global.MORSE.state; },
    log: function() { return h.storage.readJSON("morse.log.json", 1) || []; }
  };
}

module.exports = { boot: boot, START: START };
