const { test } = require("node:test");
const assert = require("node:assert");
const TL = require("../tap-language.js");

// Feed taps at the given times, ticking every 50 ms, and collect events.
function run(decoder, taps, until) {
  const events = [];
  var i = 0;
  for (let t = 0; t <= until; t += 50) {
    while (i < taps.length && taps[i] <= t) events.push(...decoder.tap(taps[i++]));
    events.push(...decoder.tick(t));
  }
  return events;
}

// Times for: password, then `symptom` taps, a pause, `severity` taps.
function sequence(symptom, severity) {
  const taps = [1000, 1200, 1900]; // tap, tap (200 ms), tap (700 ms pause)
  var t = 1900 + 600 + TL.TIMING.ECHO_MS + 300;
  for (let i = 0; i < symptom; i++) { taps.push(t); t += 300; }
  t += TL.TIMING.GROUP_GAP_MS + 200;
  for (let i = 0; i < severity; i++) { taps.push(t); t += 300; }
  return taps;
}

test("password, symptom and severity log one event", () => {
  const ev = run(TL.createDecoder(), sequence(2, 3), 15000);
  assert.ok(ev.some(e => e.type === "armed"));
  assert.deepStrictEqual(ev.filter(e => e.type === "logged"), [{ type: "logged", symptom: 2, severity: 3 }]);
});

test("three even taps are not the password", () => {
  const ev = run(TL.createDecoder(), [1000, 1200, 1400], 6000);
  assert.ok(!ev.some(e => e.type === "armed"));
  assert.ok(ev.some(e => e.type === "cancel" && e.reason === "rhythm"));
});

test("a fourth symptom tap cancels unless flare is enabled", () => {
  const taps = sequence(4, 1);
  assert.ok(run(TL.createDecoder(), taps, 15000).some(e => e.type === "cancel" && e.reason === "too many"));
  const ev = run(TL.createDecoder({ flare: true }), taps, 15000);
  assert.deepStrictEqual(ev.filter(e => e.type === "logged")[0], { type: "logged", symptom: 4, severity: 1 });
});

test("arming and then doing nothing cancels", () => {
  const ev = run(TL.createDecoder(), [1000, 1200, 1900], 12000);
  assert.ok(ev.some(e => e.type === "cancel" && e.reason === "timeout"));
});

test("a symptom with no severity cancels", () => {
  const taps = sequence(1, 0);
  const ev = run(TL.createDecoder(), taps, 15000);
  assert.ok(ev.some(e => e.type === "cancel" && e.reason === "no severity"));
});

test("practice mode skips the password", () => {
  const ev = run(TL.createDecoder({ password: false }), [100, 400, 1800, 2100], 8000);
  assert.deepStrictEqual(ev.filter(e => e.type === "logged"), [{ type: "logged", symptom: 2, severity: 2 }]);
});

test("echo pattern alternates on and off with a long gap between groups", () => {
  assert.deepStrictEqual(TL.echoPattern([2, 1]), [90, 170, 90, 650, 90]);
});

test("trainer starts with two symptoms and unlocks the third at 90%", () => {
  var tr = TL.newTrainer(3);
  assert.strictEqual(tr.unlocked, 2);
  for (let i = 0; i < 10; i++) tr = TL.record(tr, { symptom: 1, severity: 1 }, true).trainer;
  for (let i = 0; i < 9; i++) tr = TL.record(tr, { symptom: 2, severity: 1 }, true).trainer;
  assert.strictEqual(tr.unlocked, 2);
  const r = TL.record(tr, { symptom: 2, severity: 1 }, true);
  assert.ok(r.unlocked);
  assert.strictEqual(r.trainer.unlocked, 3);
});

test("trainer favours the weaker code", () => {
  var tr = TL.newTrainer(3);
  for (let i = 0; i < 10; i++) {
    tr = TL.record(tr, { symptom: 1, severity: 1 }, true).trainer;
    tr = TL.record(tr, { symptom: 2, severity: 1 }, i % 2 === 0).trainer;
  }
  var seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  var twos = 0;
  for (let i = 0; i < 1000; i++) if (TL.nextPrompt(tr, rand).symptom === 2) twos++;
  assert.ok(twos > 600, `symptom 2 drawn ${twos}/1000`);
});

test("reviews stretch on a pass and reset on a fail", () => {
  var tr = TL.newTrainer(3);
  tr = TL.scheduleReview(tr, 1, 0);
  assert.strictEqual(tr.nextReview, 2 * 86400000);
  tr = TL.scheduleReview(tr, 0.5, 0);
  assert.strictEqual(tr.nextReview, 1 * 86400000);
});
