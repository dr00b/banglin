"use strict";

// One sync from watch to Guava: a fake watch over the real UART transport,
// and a fake Guava behind the real client.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { runCycle } = require("../core/cycle.js");
const { createUartTransport } = require("../core/uart-transport.js");
const { createGuava } = require("../core/guava.js");
const { DEFAULTS } = require("../core/state.js");
const { createFakeWatch, events } = require("./fake-watch.js");
const { createFakeGuava, memoryStore } = require("./fake-guava.js");

const config = Object.assign({}, DEFAULTS, { watch: "F1:23:45:67:89:AB" });

function setup(t, files, cfg) {
  const w = createFakeWatch({ files: files });
  t.after(w.restore);
  const fake = createFakeGuava(), store = memoryStore();
  store.tokens = fake.signedIn(Date.now() + 3600000);
  const guava = createGuava({ env: "test", clientId: "cid", clientSecret: "secret", store: store, fetch: fake.fetch });
  const c = Object.assign({}, config, cfg || {});
  return {
    w: w, fake: fake,
    cycle: function(o) {
      return runCycle({ transport: createUartTransport(w.pipe(), Object.assign({ timeoutMs: 200 }, o)), guava: guava, config: c });
    }
  };
}
const logOf = (evs) => ({ "morse.log.json": JSON.stringify(evs) });

test("events reach Guava and only then is the watch acked", async function(t) {
  const s = setup(t, logOf(events(3)));
  const r = await s.cycle();
  assert.deepStrictEqual(r, { fetched: 3, accepted: 3, acked: 3 });
  assert.deepStrictEqual(s.fake.entries.map((e) => [e.type, e.symptom_name, e.severity]),
    [["symptoms", "Headache", 4], ["symptoms", "Headache", 6], ["symptoms", "Headache", 8]]);
  assert.strictEqual(s.w.sync().acked, 3);
  assert.strictEqual(s.w.closed, 1);
});

test("if Guava fails nothing is acked and the next cycle sends the same events", async function(t) {
  const s = setup(t, logOf(events(2)));
  s.fake.failData = 1;
  await assert.rejects(s.cycle(), /HTTP 503/);
  assert.strictEqual(s.w.sync().acked, undefined);
  assert.strictEqual(s.w.closed, 1, "disconnected even though it failed");
  assert.deepStrictEqual(await s.cycle(), { fetched: 2, accepted: 2, acked: 2 });
});

test("a lost ack resends with the same identifiers, which Guava ignores", async function(t) {
  const s = setup(t, logOf(events(2)));
  s.w.swallow = (js) => js.indexOf("ACKED") >= 0 && !s.w.swallowed && (s.w.swallowed = true);
  await assert.rejects(s.cycle(), /didn't answer/);
  // The ack ran on the watch but its answer was lost; simulate it not having run.
  s.w.storage.erase("morse.sync.json");
  assert.deepStrictEqual(await s.cycle(), { fetched: 2, accepted: 0, acked: 2 });
  assert.strictEqual(s.fake.entries.length, 2, "no duplicates in Guava");
});

test("with nothing waiting, Guava isn't called but the sync time is stamped", async function(t) {
  const s = setup(t, Object.assign(logOf(events(2)), { "morse.sync.json": JSON.stringify({ acked: 2 }) }));
  assert.deepStrictEqual(await s.cycle(), { fetched: 0, accepted: 0, acked: 2 });
  assert.strictEqual(s.fake.calls.length, 0);
  assert.ok(s.w.sync().last > 0);
});

test("a backlog bigger than one batch drains over several cycles without gaps", async function(t) {
  const s = setup(t, logOf(events(7)), { batchLimit: 3 });
  for (let i = 0; i < 3; i++) await s.cycle();
  assert.deepStrictEqual(s.fake.entries.map((e) => e.identifier[0].value.split("-")[1]), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.strictEqual(s.w.sync().acked, 7);
});

test("events logged by the real engine sync end to end", async function(t) {
  // Log a severity-3 event with the real boot.js, then sync its storage.
  const harness = require(path.resolve(__dirname, "../../apps/mr-morse/tests/harness.js"));
  const b = harness.boot({ settings: { symptom: "Migraine" } });
  b.tap(false); b.advance(230); b.tap(false); b.advance(700); b.tap(false); b.advance(1800);
  b.tap(false); b.advance(250); b.tap(false); b.advance(250); b.tap(false); b.advance(4400);
  const files = { "morse.log.json": b.h.storage.files["morse.log.json"] };
  b.restore();

  const s = setup(t, files);
  assert.deepStrictEqual(await s.cycle(), { fetched: 1, accepted: 1, acked: 1 });
  assert.deepStrictEqual([s.fake.entries[0].symptom_name, s.fake.entries[0].severity], ["Migraine", 6]);
});
