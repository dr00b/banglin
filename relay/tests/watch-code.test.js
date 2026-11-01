"use strict";

// The code banglin-sync runs on the watch, run against the Bangle mock, and
// the parsing of what it prints.

const test = require("node:test");
const assert = require("node:assert");
const code = require("../core/watch-code.js");
const { createFakeWatch, events } = require("./fake-watch.js");

function watch(t, files, clock) {
  const w = createFakeWatch({ files: files, clock: clock });
  t.after(w.restore);
  return w;
}
const files = (log, sync, settings) => Object.assign(
  { "morse.log.json": JSON.stringify(log) },
  sync ? { "morse.sync.json": JSON.stringify(sync) } : {},
  settings ? { "morse.json": JSON.stringify(settings) } : {});
const dump = (w, o) => code.parseDump(w.run(code.buildDumpCode(Object.assign({ now: w.clock, tzHours: 0, limit: 200 }, o))));

test("the dump sends only events above the acked cursor, lowest id first", function(t) {
  const log = events(5);
  log.push(log.splice(1, 1)[0]); // id 2 now last in the file
  const w = watch(t, files(log, { acked: 1 }));
  const d = dump(w);
  assert.strictEqual(d.acked, 1);
  assert.deepStrictEqual(d.events.map((e) => e.id), [2, 3, 4, 5]);
  assert.deepStrictEqual(Object.keys(d.events[0]).sort(), ["id", "s", "sym", "t"]);
});

test("events from before ids existed get ids above every used one, and are kept", function(t) {
  const legacy = [{ t: 100, s: 2, src: "tap" }, { t: 200, s: 4, src: "tap" }];
  const w = watch(t, files(legacy.concat(events(2, 6)), { acked: 9 }, { symptom: "Nausea" }));
  const d = dump(w);
  assert.deepStrictEqual(d.events.map((e) => [e.id, e.t, e.sym]), [[10, 100, "Nausea"], [11, 200, "Nausea"]],
    "ids above both the log (8) and the cursor (9); the symptom setting fills in");
  assert.deepStrictEqual(w.log().map((e) => e.id), [10, 11, 7, 8], "ids written back, so the next dump agrees");
});

test("a batch limit takes the lowest ids, so acking the top of a batch skips nothing", function(t) {
  const legacy = [{ t: 100, s: 2 }, { t: 200, s: 3 }, { t: 300, s: 4 }];
  const w = watch(t, files(legacy.concat(events(2)))); // ids become 3,4,5 then 1,2
  assert.deepStrictEqual(dump(w, { limit: 2 }).events.map((e) => e.id), [1, 2]);
  w.run(code.buildAckCode(2, w.clock));
  assert.deepStrictEqual(dump(w, { limit: 2 }).events.map((e) => e.id), [3, 4]);
});

test("the dump sets the watch clock when it has drifted, and the timezone every time", function(t) {
  const w = watch(t, files([]), 1000);
  dump(w, { now: 1001, tzHours: -5 });
  assert.deepStrictEqual([w.clock, w.tz], [1000, -5], "within 2 s is left alone");
  dump(w, { now: 5000, tzHours: 1 });
  assert.deepStrictEqual([w.clock, w.tz], [5000, 1]);
});

test("the ack moves the cursor up but never back, and stamps the sync time", function(t) {
  const w = watch(t, files(events(3), { acked: 2 }));
  assert.strictEqual(code.parseAck(w.run(code.buildAckCode(1, 500))), 2);
  assert.deepStrictEqual(w.sync(), { acked: 2, last: 500 });
  assert.strictEqual(code.parseAck(w.run(code.buildAckCode(3, 600))), 3);
  assert.strictEqual(code.parseAck(w.run(code.buildAckCode(null, 700))), 3);
  assert.deepStrictEqual(w.sync(), { acked: 3, last: 700 });
});

test("the ack tells the engine what's still waiting and redraws the widget", function(t) {
  const w = watch(t, files(events(3)));
  let draws = 0;
  global.MORSE = { unsent: true };
  global.WIDGETS.morse = { draw: function() { draws++; } };
  t.after(function() { delete global.MORSE; });
  w.run(code.buildAckCode(2, 1));
  assert.deepStrictEqual([global.MORSE.unsent, draws], [true, 1]);
  w.run(code.buildAckCode(3, 2));
  assert.deepStrictEqual([global.MORSE.unsent, draws], [false, 2]);
});

test("a dump cut short or miscounted is rejected", function() {
  const ok = "<<<EVENTS 0 2>>>\n{\"id\":1}\n{\"id\":2}\n<<<END 2>>>\n<<<DONE>>>\n";
  assert.strictEqual(code.parseDump(ok).events.length, 2);
  assert.throws(() => code.parseDump("<<<EVENTS 0 2>>>\n{\"id\":1}\n<<<END 2>>>\n<<<DONE>>>"), /expected 2 events, got 1/);
  assert.throws(() => code.parseDump("<<<EVENTS 0 2>>>\n{\"id\":1}\n"), /cut short/);
  assert.throws(() => code.parseDump("<<<EVENTS 0 1>>>\n{\"id\":\n<<<END 1>>>"), /unreadable/);
  assert.throws(() => code.parseDump("Uncaught SyntaxError\n<<<DONE>>>"), /no events header/);
  assert.throws(() => code.parseAck("<<<DONE>>>"), /didn't confirm/);
});

test("console prompts and carriage returns don't confuse the parser", function() {
  const out = ">\r\n<<<EVENTS 4 1>>>\r\n{\"id\":5,\"t\":1,\"s\":3,\"sym\":\"A\"}\r\n<<<END 1>>>\r\n<<<DONE>>>\r\n>";
  assert.deepStrictEqual(code.parseDump(out), { acked: 4, events: [{ id: 5, t: 1, s: 3, sym: "A" }] });
  assert.ok(code.isDone(out));
});

test("bad options never reach the watch", function() {
  assert.throws(() => code.buildDumpCode({ now: 1, tzHours: "0;evil()", limit: 5 }), /bad dump options/);
  assert.throws(() => code.buildDumpCode({ now: 1, tzHours: 0, limit: 0 }), /bad dump options/);
  assert.throws(() => code.buildAckCode("1;evil()", 1), /bad ack id/);
});
