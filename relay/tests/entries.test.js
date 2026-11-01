"use strict";

// Watch events to Guava symptom entries.

const test = require("node:test");
const assert = require("node:assert");
const entries = require("../core/entries.js");
const { DEFAULTS } = require("../core/state.js");

function withTZ(t, tz) {
  const old = process.env.TZ;
  process.env.TZ = tz;
  t.after(function() { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; });
}
const opts = { watchId: "F1:23:45:67:89:AB", severityMap: DEFAULTS.severityMap, notes: "n" };

test("watch severity 1-5 maps to Guava's 0-10 scale, and an unmapped one is refused", function() {
  assert.deepStrictEqual([1, 2, 3, 4, 5].map((s) => entries.mapSeverity(s, DEFAULTS.severityMap)), [2, 4, 6, 8, 10]);
  assert.throws(() => entries.mapSeverity(6, DEFAULTS.severityMap), /no Guava severity/);
  assert.throws(() => entries.mapSeverity(1, { 1: 11 }), /no Guava severity/);
});

test("times carry the local offset at that instant, across DST", function(t) {
  withTZ(t, "America/New_York");
  assert.strictEqual(entries.isoWithOffset(Date.UTC(2026, 0, 15, 17, 4, 5) / 1000), "2026-01-15T12:04:05-05:00");
  assert.strictEqual(entries.isoWithOffset(Date.UTC(2026, 6, 15, 17, 4, 5) / 1000), "2026-07-15T13:04:05-04:00");
  process.env.TZ = "Asia/Kolkata";
  assert.strictEqual(entries.isoWithOffset(Date.UTC(2026, 0, 15, 17, 4, 5) / 1000), "2026-01-15T22:34:05+05:30");
});

test("each entry's identifier ties it to one event on one watch", function(t) {
  withTZ(t, "UTC");
  const out = entries.toEntries([{ id: 7, t: 0, s: 3, sym: "Headache" }], opts);
  assert.deepStrictEqual(out, [{
    time: "1970-01-01T00:00:00+00:00", symptom_name: "Headache", severity: 6, notes: "n",
    identifier: [{ system: "banglin.mr-morse", value: "F1:23:45:67:89:AB-7" }]
  }]);
  assert.deepStrictEqual(entries.toEntries([{ id: 7, t: 999, s: 1, sym: "Other" }], opts)[0].identifier, out[0].identifier,
    "the same event id always gives the same identifier");
});

test("symptom names come from the event, with a fallback and Guava's 255-char limit", function() {
  const [a, b] = entries.toEntries([{ id: 1, t: 0, s: 1 }, { id: 2, t: 0, s: 1, sym: "x".repeat(300) }], opts);
  assert.strictEqual(a.symptom_name, "Symptom");
  assert.strictEqual(b.symptom_name.length, 255);
  assert.throws(() => entries.toEntries([{ t: 0, s: 1 }], opts), /bad event/);
});
