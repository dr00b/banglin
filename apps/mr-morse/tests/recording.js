"use strict";

// Field recordings (recorder.js on the watch) in node: parse one, replay it
// through the engine via the harness, and compare what the watch decided
// live with what the same code decides here.

const path = require("node:path");
const harness = require(path.resolve(__dirname, "harness.js"));

// Decisions that matter: what the user would notice, and why not.
const DECISIONS = ["reject", "echo", "done", "cancel"];

function num(v) { return v === undefined || isNaN(+v) ? v : +v; }

function parse(text) {
  const out = { header: null, events: [], live: [], stopped: null, bad: [] };
  text.split("\n").forEach(function(raw, i) {
    const line = raw.trim();
    if (!line) return;
    if (line[0] === "#") {
      try { out.header = JSON.parse(line.slice(1)); } catch (e) { out.bad.push(i + 1); }
      return;
    }
    const f = line.split(","), t = +f[1];
    if (isNaN(t)) { out.bad.push(i + 1); return; }
    switch (f[0]) {
      case "b": out.events.push({ t: t, type: "boot", locked: f[2] === "1", fresh: f[3] === "1" }); break;
      case "a": {
        const x = f[2] / 1000, y = f[3] / 1000, z = f[4] / 1000;
        out.events.push({ t: t, type: "accel", x: x, y: y, z: z, diff: f[5] / 1000, mag: Math.hypot(x, y, z) });
        break;
      }
      case "t": out.events.push({ t: t, type: "tap", dir: f[2], double: f[3] === "1" }); break;
      case "l": out.events.push({ t: t, type: "lock", locked: f[2] === "1" }); break;
      case "p": out.events.push({ t: t, type: "touch" }); break;
      case "e": out.live.push({ t: t, kind: f[2], arg: num(f[3]) }); break;
      case "s": out.stopped = t; break;
      default: out.bad.push(i + 1);
    }
  });
  return out;
}

// Replay a parsed recording. The first boot line is the session start (the
// harness has just booted); a later fresh boot is an app load on the watch,
// which restarts the engine. `overrides` replaces settings, to try a tuning
// against a real session without recording it again.
function replay(rec, overrides) {
  const h = rec.header || {};
  const first = rec.events.find(function(e) { return e.type === "boot"; });
  const engine = harness.boot({
    settings: Object.assign({}, h.settings, overrides), start: h.start, locked: first ? first.locked : true
  });
  let booted = false;
  const events = rec.events.filter(function(e) {
    if (e.type !== "boot") return true;
    const keep = booted && e.fresh;
    booted = true;
    return keep;
  });
  try {
    engine.run(events, 0);
    if (rec.stopped !== null) engine.advanceTo(engine.start + rec.stopped);
    return { decisions: engine.m.decisions, metrics: engine.metrics() };
  } finally {
    engine.restore();
  }
}

function decisions(list) {
  return list.filter(function(d) { return DECISIONS.indexOf(d.kind) >= 0; });
}

// Live and replayed decisions must be the same, in the same order, within
// toleranceMs of each other (timers on the watch jitter; the tick is 250 ms).
function compare(live, replayed, toleranceMs) {
  const a = decisions(live), b = decisions(replayed), tol = toleranceMs || 300;
  const problems = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    const show = function(d) { return d ? d.kind + (d.arg === undefined ? "" : ":" + d.arg) + "@" + d.t : "nothing"; };
    if (!x || !y || x.kind !== y.kind || x.arg !== y.arg || Math.abs(x.t - y.t) > tol) {
      problems.push("#" + i + ": watch " + show(x) + ", replay " + show(y));
    }
  }
  return problems;
}

// The password rhythm in a recording: for every attempt that reached the
// confirming tap, the pair gap and the pause. For tuning the windows.
function rhythm(rec) {
  const taps = rec.events.filter(function(e) { return e.type === "tap"; });
  const out = [];
  rec.live.filter(function(d) { return d.kind === "echo"; }).forEach(function(echo) {
    const before = taps.filter(function(t) { return t.t < echo.t; }).slice(-3);
    if (before.length === 3) out.push({ pair: before[1].t - before[0].t, pause: before[2].t - before[1].t });
  });
  return out;
}

function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort(function(x, y) { return x - y; });
  return s[s.length >> 1];
}

// What a session looked like at the sensor, to set beside the simulated
// scenario of the same name and to answer the questions in FIELD-TESTS.md.
function summary(rec) {
  const taps = rec.events.filter(function(e) { return e.type === "tap"; });
  const accel = rec.events.filter(function(e) { return e.type === "accel"; });
  const last = rec.events.length ? rec.events[rec.events.length - 1].t : 0;
  const minutes = (rec.stopped !== null ? rec.stopped : last) / 60000;
  const dirs = {};
  taps.forEach(function(t) { dirs[t.dir] = (dirs[t.dir] || 0) + 1; });
  // Taps the firmware reads in its accelerometer poll arrive in the same
  // millisecond or two as a reading: near 100% if so, ~5% by chance if not.
  const times = accel.map(function(a) { return a.t; });
  let j = 0;
  const aligned = taps.filter(function(t) {
    while (j < times.length - 1 && times[j + 1] <= t.t) j++;
    return Math.min(Math.abs(t.t - times[j]), j + 1 < times.length ? Math.abs(times[j + 1] - t.t) : Infinity) <= 2;
  }).length;
  const diffs = accel.map(function(a) { return a.diff; });
  let on = null, onMs = 0;
  rec.live.forEach(function(d) {
    if (d.kind === "mon") on = d.t;
    else if (d.kind === "moff" && on !== null) { onMs += d.t - on; on = null; }
  });
  const counts = {};
  decisions(rec.live).forEach(function(d) {
    const k = d.kind + (d.kind === "reject" ? ":" + d.arg : "");
    counts[k] = (counts[k] || 0) + 1;
  });
  return {
    label: rec.header && rec.header.label,
    minutes: +minutes.toFixed(1),
    tapsPerMin: +(taps.length / (minutes || 1)).toFixed(1),
    doubles: taps.filter(function(t) { return t.double; }).length,
    directions: dirs,
    tapsOnPoll: taps.length ? Math.round(100 * aligned / taps.length) + "%" : "-",
    wristMedianG: median(diffs),
    wristP90G: diffs.length ? diffs.slice().sort(function(x, y) { return x - y; })[Math.floor(diffs.length * 0.9)] : null,
    streamOnPct: +(100 * onMs / ((minutes || 1) * 60000)).toFixed(2),
    decisions: counts,
    logged: decisions(rec.live).filter(function(d) { return d.kind === "done"; }).map(function(d) { return d.arg; }),
    rhythm: rhythm(rec)
  };
}

module.exports = { parse: parse, replay: replay, compare: compare, decisions: decisions, rhythm: rhythm, summary: summary };

// node apps/mr-morse/tests/recording.js <file.csv> [--set key=value ...]
// Prints the summary; with --set, also replays with those settings changed.
if (require.main === module) {
  const fs = require("node:fs");
  const args = process.argv.slice(2), overrides = {};
  let file = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--set") {
      const kv = args[++i].split("=");
      overrides[kv[0]] = isNaN(+kv[1]) ? kv[1] : +kv[1];
    } else file = args[i];
  }
  if (!file) { console.error("usage: node recording.js <file.csv> [--set key=value ...]"); process.exit(2); }
  const rec = parse(fs.readFileSync(file, "utf8"));
  console.log(JSON.stringify(summary(rec), null, 2));
  if (Object.keys(overrides).length) {
    const r = replay(rec, overrides);
    console.log("replayed with " + JSON.stringify(overrides) + ": logged " + JSON.stringify(r.metrics.done) +
      ", echoes " + r.metrics.echoes + ", refused " + JSON.stringify(r.metrics.rejects));
  }
}
