"use strict";

// Field recordings: sessions recorded on the watch with the app's Field test
// (recorder.js), replayed through the same engine here. Each must decide
// exactly what the watch decided, and meet the expectation it was recorded
// with. FIELD-TESTS.md says how to make and collect them.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const sim = require(path.resolve(__dirname, "../../../tests/helpers/accel-sim.js"));
const harness = require(path.resolve(__dirname, "harness.js"));
const recording = require(path.resolve(__dirname, "recording.js"));

const DIR = path.join(__dirname, "recordings");

// A simulated session recorded by recorder.js on the mocked watch: patting,
// quiet, a password (3), an app load, another password (2). Returns what the
// engine decided live and the file the recorder wrote.
function recordSession(o) {
  o = o || {};
  const r = sim.rng(42);
  const sig = sim.createSignal(150000);
  sim.addGravity(sig, () => ({ pitch: -0.2, roll: 0.1 }));
  sim.addNoise(sig, r, { tremor: 0.006 });
  sim.addOscillation(sig, 2, 0.4, 2.5, 0, 30000);
  for (let t = 100; t < 30000; t += 400) sim.addImpact(sig, { t: t, peak: 2, widthMs: 15, dir: r.dir(2) });
  const tap = (t) => sim.addImpact(sig, { t: t, peak: 3, widthMs: 8, dir: r.near([0, 0, -1]) });
  [[40000, 3], [100000, 2]].forEach(function(p) {
    [0, 230, 930].forEach((d) => tap(p[0] + d));
    for (let i = 0; i < p[1]; i++) tap(p[0] + 3400 + i * 350);
  });
  const start = harness.START;
  const rec = { file: "morse.rtest.csv", start: start, until: start + 140000, label: "round-trip" };
  const header = { v: 1, label: rec.label, expect: "logs", severity: 3, attempts: 2, start: start, minutes: 2, settings: {} };
  const files = { "morse.rec.json": JSON.stringify(rec) };
  files[rec.file] = "#" + JSON.stringify(header) + "\n";
  const engine = harness.boot({ files: files, motor: sim.rng(1) });
  try {
    const events = sim.timeline(sim.sense(sig, { tapMode: o.tapMode || "single" }), [{ t: 80000, type: "boot", locked: true }]);
    engine.run(events, 0);
    engine.advanceTo(rec.until + 5000);
    return {
      live: engine.m.decisions, text: engine.h.storage.files[rec.file], metrics: engine.metrics(),
      marker: engine.h.storage.files["morse.rec.json"], log: engine.log(), rec: global.MORSE.rec
    };
  } finally {
    engine.restore();
  }
}

test("recorder round trip: what the watch decided, the replay decides too", function() {
  ["single", "double"].forEach(function(mode) {
    const s = recordSession({ tapMode: mode });
    const parsed = recording.parse(s.text);
    assert.deepStrictEqual(parsed.bad, [], "every line parses");
    assert.strictEqual(parsed.header.label, "round-trip");
    assert.strictEqual(parsed.events.filter((e) => e.type === "boot").length, 2, "session start and the app load");
    const untilStop = s.live.filter((d) => d.t <= parsed.stopped);   // its own end buzz comes after
    assert.deepStrictEqual(recording.compare(untilStop, parsed.live), [], "the file holds every decision");
    const replayed = recording.replay(parsed);
    assert.deepStrictEqual(recording.compare(parsed.live, replayed.decisions), [], mode + ": replay matches");
    assert.deepStrictEqual(replayed.metrics.done, [3, 2], mode + ": both passwords");
  });
});

test("recorder: counts are traced but not logged, and it stops itself", function() {
  const s = recordSession();
  assert.deepStrictEqual(s.metrics.done, [3, 2]);
  assert.deepStrictEqual(s.log, [], "a field test doesn't fill the event log");
  assert.strictEqual(s.marker, undefined, "marker gone once the time is up");
  assert.strictEqual(s.rec, null);
  assert.ok(recording.parse(s.text).stopped !== null, "stop line written");
  assert.ok(s.metrics.atRest, "power-save back on, nothing listening");
});

test("recorder: writes to flash every couple of seconds, not per reading", function() {
  const s = recordSession();
  const writes = s.metrics.flash, bytes = s.text.length, readings = (s.text.match(/^a,/gm) || []).length;
  assert.ok(readings > 1500, readings + " readings at 12.5 Hz");
  assert.ok(writes <= s.metrics.durationMs / 2000 + 10, writes + " writes in " + (s.metrics.durationMs / 1000) + " s");
  assert.ok(bytes / writes > 400, Math.round(bytes / writes) + " bytes per write");
});

test("recording summary describes the session at the sensor", function() {
  const sum = recording.summary(recording.parse(recordSession().text));
  assert.strictEqual(sum.label, "round-trip");
  assert.ok(sum.minutes > 2 && sum.minutes < 2.5, "minutes " + sum.minutes);
  assert.ok(sum.directions.back >= 11, "the password taps come from the face: " + JSON.stringify(sum.directions));
  assert.deepStrictEqual(sum.logged, [3, 2]);
  assert.strictEqual(sum.rhythm.length, 2, "both passwords' rhythm measured");
  sum.rhythm.forEach((x) => assert.ok(Math.abs(x.pair - 230) < 15 && Math.abs(x.pause - 700) < 15, JSON.stringify(x)));
  assert.ok(parseInt(sum.tapsOnPoll, 10) < 20, "the simulator delivers taps between readings (~5% by chance): " + sum.tapsOnPoll);
  assert.ok(sum.streamOnPct > 0 && sum.streamOnPct < 5, "stream on " + sum.streamOnPct + "%");
});

test("recording parser flags lines it can't read", function() {
  const p = recording.parse("#{\"v\":1}\na,10,0,0,-1000,5\nt,20,front,0\nzzz\na,oops\ne,30,done,3\n");
  assert.deepStrictEqual(p.bad, [4, 5]);
  assert.strictEqual(p.events.length, 2);
  assert.deepStrictEqual(p.live, [{ t: 30, kind: "done", arg: 3 }]);
});

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.csv$/.test(f)).sort() : [];

if (!files.length) {
  test("field recordings: none yet", { skip: "record some with the app's Field test, see FIELD-TESTS.md" }, function() {});
}

for (const f of files) {
  const load = () => recording.parse(fs.readFileSync(path.join(DIR, f), "utf8"));

  test(`field recording ${f}: the replay decides what the watch decided`, function(t) {
    const rec = load();
    assert.deepStrictEqual(rec.bad, [], "lines lost or garbled on the way off the watch");
    assert.ok(rec.header, "has its header");
    const replayed = recording.replay(rec);
    t.diagnostic(rec.header.label + ": " + recording.decisions(rec.live).map((d) => d.kind + (d.arg === undefined ? "" : ":" + d.arg)).join(" "));
    assert.deepStrictEqual(recording.compare(rec.live, replayed.decisions), []);
  });

  test(`field recording ${f}: meets its expectation`, function(t) {
    const rec = load(), h = rec.header;
    const live = recording.decisions(rec.live);
    const done = live.filter((d) => d.kind === "done").map((d) => d.arg);
    const echoes = live.filter((d) => d.kind === "echo").length;
    if (h.expect === "silent") {
      assert.strictEqual(echoes, 0, h.label + ": armed " + echoes + " times");
      return;
    }
    const rhythm = recording.rhythm(rec);
    t.diagnostic("rhythm (pair, pause ms): " + rhythm.map((x) => x.pair + "/" + x.pause).join(" "));
    t.diagnostic("logged " + done.join(",") + " for " + h.attempts + " x " + h.severity);
    assert.ok(done.every((d) => d === h.severity), "a wrong number was logged: " + done.join(","));
    if (h.label !== "password-walking") {
      assert.ok(done.length >= Math.ceil(0.8 * h.attempts), done.length + " of " + h.attempts + " attempts logged");
    }
  });
}
