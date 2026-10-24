"use strict";

// Everyday life, simulated at the accelerometer, run through the real engine
// (boot.js + lib/morse-protocol.js) via the harness. Proves the watch doesn't
// arm, buzz, log or burn battery when nobody is signalling, and that the real
// password still works. Scenarios are in scenarios.js; each runs for
// SIM_SEEDS seeds (default 3; try SIM_SEEDS=20 for a long soak) under three
// models of the chip's tap reporting:
//   single        every tap reported on its own
//   double        the chip's double-tap detection fuses some pairs
//   every-impact  stress: every knock over 0.3 g is a tap, however soft or blunt

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const sim = require(path.resolve(__dirname, "../../../tests/helpers/accel-sim.js"));
const power = require(path.resolve(__dirname, "../../../tests/helpers/power-model.js"));
const harness = require(path.resolve(__dirname, "harness.js"));
const { SCENARIOS } = require(path.resolve(__dirname, "scenarios.js"));

const SEEDS = +process.env.SIM_SEEDS || 3;
const MODES = ["single", "double", "every-impact"];
const LOCK = { tapDir: "back" };   // a finger on the face, in the simulator's frame
const HOUR = 3600000;

// Caps on false logs per simulated hour for the scattered scenarios, from a
// 30-seed soak (worst seen: 0.6 realistic, 3.7 stress, 0 locked) with margin.
// One event of slack on top, so a short run isn't judged on a single fluke.
const SCATTER_CAP = { realistic: 1.5, stress: 6, locked: 0.25 };

// Battery budgets, per scenario and tap model, over all seeds. "extras" is
// what the engine adds on top of handling each tap (which any tap-driven app
// pays): the 12.5 Hz stream, its timers, widget redraws.
const BUDGET = {
  realistic: { fastPct: 2.5, extrasPctOfIdle: 5 },
  "every-impact": { fastPct: 10, extrasPctOfIdle: 20 }
};

function seedOf(name, i) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h + i * 7919) >>> 0;
}

// Each scenario is built once per seed and sensed under every tap model.
// Results are cached so the safety and battery tests share one run.
const cache = new Map();
function results(s, settings) {
  const key = s.name + JSON.stringify(settings || {});
  if (cache.has(key)) return cache.get(key);
  const out = [];
  for (let i = 1; i <= SEEDS; i++) {
    const built = s.build(sim.rng(seedOf(s.name, i)));
    for (const mode of MODES) {
      const engine = harness.boot({ settings: settings, motor: sim.rng(i) });
      try {
        engine.run(sim.timeline(sim.sense(built.sig, { tapMode: mode })));
        out.push({ seed: i, mode: mode, attempts: built.attempts, m: engine.metrics() });
      } finally {
        engine.restore();
      }
    }
  }
  cache.set(key, out);
  return out;
}

function where(r) { return "seed " + r.seed + ", " + r.mode; }

function assertSilent(r) {
  assert.strictEqual(r.m.echoes, 0, "no echo buzz: " + where(r));
  assert.deepStrictEqual(r.m.done, [], "nothing logged: " + where(r));
  assert.strictEqual(r.m.buzzes, 0, "no buzz at all: " + where(r));
  assert.strictEqual(r.m.logWrites, 0, "no flash writes: " + where(r));
  assert.ok(r.m.atRest, "back at rest: " + where(r));
}

// Match each log to the attempt that armed it: its echo played between the
// attempt's first and last tap. Those must log what was tapped: never more,
// and fewer only when a tap was too soft for the chip to register at all,
// which the engine can't know about (the buzz-back tells the user). A log
// armed outside every attempt is a false one (scattered knocks before or
// between attempts) and is counted as such.
function attribute(r) {
  const out = { hits: 0, over: [], short: [], extra: 0 };
  r.m.logged.forEach(function(l) {
    const a = r.attempts.find((x) => l.echoAt !== null && l.echoAt >= x.start && l.echoAt <= x.end);
    const what = "logged " + (l.severity) + " for " + (a && a.severity) + " at " + Math.round(l.t) + " ms";
    if (!a) out.extra++;
    else if (l.severity === a.severity) out.hits++;
    else (l.severity > a.severity ? out.over : out.short).push(what);
  });
  return out;
}

function sum(rs, f) { return rs.reduce((a, r) => a + f(r), 0); }

function assertBudget(t, s) {
  for (const mode of MODES) {
    const rs = results(s).filter((r) => r.mode === mode);
    const ms = sum(rs, (r) => r.m.durationMs);
    const fastMs = sum(rs, (r) => r.m.fastMs);
    const extras = power.estimate({
      accel: sum(rs, (r) => r.m.accel), timers: sum(rs, (r) => r.m.timerFires),
      draws: sum(rs, (r) => r.m.draws), fastMs: fastMs
    }, ms);
    const all = power.estimate({
      taps: sum(rs, (r) => r.m.taps), accel: sum(rs, (r) => r.m.accel), timers: sum(rs, (r) => r.m.timerFires),
      draws: sum(rs, (r) => r.m.draws), fastMs: fastMs
    }, ms);
    const b = BUDGET[mode] || BUDGET.realistic;
    const fastPct = 100 * fastMs / ms;
    t.diagnostic(mode + ": " + (sum(rs, (r) => r.m.taps) / ms * 60000).toFixed(1) + " taps/min, stream on " +
      fastPct.toFixed(2) + "%, engine extras " + extras.extraUa.toFixed(2) + " uA (" + extras.pctOfIdle.toFixed(1) +
      "% of idle), with tap handling " + all.extraUa.toFixed(2) + " uA");
    assert.ok(fastPct <= b.fastPct, mode + ": accel stream on " + fastPct.toFixed(2) + "% > " + b.fastPct + "%");
    assert.ok(extras.pctOfIdle <= b.extrasPctOfIdle,
      mode + ": engine extras " + extras.pctOfIdle.toFixed(1) + "% of idle > " + b.extrasPctOfIdle + "%");
  }
}

for (const s of SCENARIOS.filter((x) => x.kind === "everyday")) {
  test(`everyday: ${s.name} never arms`, function(t) {
    t.diagnostic(s.title);
    results(s).forEach(assertSilent);
  });
  test(`battery: ${s.name} stays within budget`, function(t) { assertBudget(t, s); });
}

for (const s of SCENARIOS.filter((x) => x.kind === "scattered")) {
  // Measured and capped, per simulated hour: the realistic tap models
  // together, the stress model on its own, and everything with the lock on.
  test(`scattered: ${s.name} rarely logs, rarer still with Tap direction set`, function(t) {
    t.diagnostic(s.title);
    const rs = results(s), locked = results(s, LOCK);
    const check = function(label, list, cap) {
      const logs = sum(list, (r) => r.m.done.length), hours = sum(list, (r) => r.m.durationMs) / HOUR;
      t.diagnostic(label + ": " + logs + " false logs in " + hours.toFixed(1) + " h (" + (logs / hours).toFixed(2) + "/h, cap " + cap + ")");
      assert.ok(logs <= cap * hours + 1, label + ": " + logs + " false logs in " + hours.toFixed(1) + " h");
    };
    check("realistic", rs.filter((r) => r.mode !== "every-impact"), SCATTER_CAP.realistic);
    check("stress", rs.filter((r) => r.mode === "every-impact"), SCATTER_CAP.stress);
    check("locked", locked, SCATTER_CAP.locked);
    rs.concat(locked).forEach((r) => {
      assert.strictEqual(r.m.logWrites, r.m.done.length, "only counted events are written: " + where(r));
      assert.ok(r.m.atRest, "back at rest: " + where(r));
    });
  });
  test(`battery: ${s.name} stays within budget`, function(t) { assertBudget(t, s); });
}

for (const s of SCENARIOS.filter((x) => x.kind === "intent")) {
  const intent = function(t, rs, minHits, note) {
    let hits = 0, extra = 0, tries = 0, short = 0;
    rs.forEach((r) => {
      const a = attribute(r);
      assert.deepStrictEqual(a.over, [], "logged more than was tapped: " + where(r));
      assert.ok(r.m.atRest, "back at rest: " + where(r));
      hits += a.hits; extra += a.extra; tries += r.attempts.length; short += a.short.length;
    });
    const hours = sum(rs, (r) => r.m.durationMs) / HOUR;
    t.diagnostic("hit rate " + (100 * hits / tries).toFixed(1) + "% (" + hits + "/" + tries + ")" + (note || "") +
      "; short counts (a soft tap unregistered): " + short + "; false logs between attempts: " + extra);
    assert.ok(hits / tries >= minHits, "hit rate " + hits + "/" + tries);
    assert.ok(short <= (s.maxShort || 0) * tries, short + " short counts in " + tries + " attempts");
    assert.ok(extra <= SCATTER_CAP.stress * hours + 1, extra + " false logs in " + hours.toFixed(1) + " h");
  };
  test(`intent: ${s.name} logs what was tapped, never a wrong number`, function(t) {
    t.diagnostic(s.title);
    intent(t, results(s), s.minHits || 0.95);
  });
  test(`intent: ${s.name} still mostly works with Tap direction set`, function(t) {
    intent(t, results(s, LOCK), 0.85, ": the chip model sometimes misreads a tap's direction");
  });
}

for (const s of SCENARIOS.filter((x) => x.kind === "limit")) {
  test(`limit: ${s.name}`, function(t) {
    t.diagnostic(s.title);
    const rs = results(s);
    const rejects = sum(rs, (r) => r.m.rejects[s.reject] || 0), echoes = sum(rs, (r) => r.m.echoes);
    t.diagnostic(rejects + " refused as " + s.reject + ", " + echoes + " got through");
    assert.ok(rejects > 0, "refused as " + s.reject);
    assert.ok(echoes <= rejects / 4, "mostly refused: " + echoes + " got through, " + rejects + " refused");
    rs.forEach((r) => assert.ok(r.m.atRest, "back at rest: " + where(r)));
  });
}
