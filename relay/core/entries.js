"use strict";

// Watch events to Guava symptom entries.
//
// A watch event is {id, t, s, sym}: a never-reused id, unix seconds, severity
// 1-5 and the symptom name it was logged under.

const IDENTIFIER_SYSTEM = "banglin.mr-morse";

function pad(n) { return (n < 10 ? "0" : "") + n; }

// ISO 8601 in this process's local timezone, with its offset at that
// instant (so DST is right for each event). Uses only Date, not Intl, which
// Node builds without full ICU (Termux) may lack.
function isoWithOffset(unixSec) {
  const d = new Date(unixSec * 1000);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-", a = Math.abs(off);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
    sign + pad(Math.floor(a / 60)) + ":" + pad(a % 60);
}

function mapSeverity(s, map) {
  const v = map[s];
  if (!Number.isInteger(v) || v < 0 || v > 10) throw new Error("no Guava severity for watch severity " + s);
  return v;
}

// opts: {watchId, severityMap, notes}. The identifier ties each entry to
// one event on one watch, so Guava ignores a resend.
function toEntries(events, opts) {
  return events.map(function(e) {
    if (!Number.isInteger(e.id) || !Number.isFinite(e.t)) throw new Error("bad event " + JSON.stringify(e));
    const entry = {
      time: isoWithOffset(e.t),
      symptom_name: String(e.sym || "Symptom").slice(0, 255),
      severity: mapSeverity(e.s, opts.severityMap),
      identifier: [{ system: IDENTIFIER_SYSTEM, value: opts.watchId + "-" + e.id }]
    };
    if (opts.notes) entry.notes = opts.notes;
    return entry;
  });
}

module.exports = { isoWithOffset, mapSeverity, toEntries, IDENTIFIER_SYSTEM };
