"use strict";

// One sync: fetch what the watch hasn't sent yet, post it to Guava, and only
// then move the watch's cursor. If the ack is lost the next cycle sends the
// same events again with the same identifiers, and Guava ignores them. If
// Guava fails nothing is acked. Knows nothing about Bluetooth.

const entries = require("./entries.js");

// opts: {transport, guava, config, now?: () => ms}
// Resolves {fetched, accepted, acked}.
async function runCycle(opts) {
  const t = opts.transport, cfg = opts.config;
  const nowSec = () => Math.round((opts.now ? opts.now() : Date.now()) / 1000);
  try {
    const dump = await t.fetch({
      limit: cfg.batchLimit,
      now: nowSec(),
      tzHours: -new Date().getTimezoneOffset() / 60
    });
    if (!dump.events.length) {
      return { fetched: 0, accepted: 0, acked: await t.ack(null, nowSec()) };
    }
    const body = entries.toEntries(dump.events, {
      watchId: cfg.watch, severityMap: cfg.severityMap, notes: cfg.notes
    });
    const res = await opts.guava.postSymptoms(body);
    const top = dump.events.reduce((m, e) => Math.max(m, e.id), dump.acked);
    return { fetched: dump.events.length, accepted: res.accepted, acked: await t.ack(top, nowSec()) };
  } finally {
    await t.close();
  }
}

module.exports = { runCycle };
