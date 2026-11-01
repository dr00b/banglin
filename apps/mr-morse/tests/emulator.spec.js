const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { startEmulator, sendCode, captureSerial } = require("../../../tests/helpers/emulator");
const dev = require("../../../scripts/dev.js");
const pull = require("../../../scripts/pull.js");
const recording = require("./recording.js");

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, rel), "utf8");
}

function store(name, text) {
  return "require(\"Storage\").write(" + JSON.stringify(name) + "," + dev.quote(text, name) + ");\n";
}

// The node tests run recorder.js and the pull code against mocks; this runs
// them on the real Espruino firmware: StorageFile appends, list({sf:true}),
// readLine, E.on("kill"), and the engine loading the recorder at boot.
test("a field test records on the real firmware, and the pull code reads it back", async ({ page }) => {
  const serial = captureSerial(page);
  await startEmulator(page);
  // A session starting now, as the app's Field test writes it. The emulator
  // ignores setTime, so "now" is the firmware's own clock.
  await sendCode(page,
    store("morse.tapseq.js", read("../../../lib/morse-protocol.js")) +
    store("morse.rec.js", read("../recorder.js")) +
    "var st=Date.now();\n" +
    "require(\"Storage\").open(\"morse.remu.csv\",\"w\").write(\"#\"+JSON.stringify({v:1,label:\"emulator\",expect:\"silent\",start:st})+\"\\n\");\n" +
    "require(\"Storage\").writeJSON(\"morse.rec.json\",{file:\"morse.remu.csv\",start:st,until:st+3600000,label:\"emulator\"});\n");
  await sendCode(page, read("../boot.js") + "\n");
  // A lone knock, a few readings, then stop: the engine decides, the recorder writes.
  await sendCode(page,
    "Bangle.emit(\"tap\",{dir:\"back\",double:false});\n" +
    "for (var i=0;i<5;i++) Bangle.emit(\"accel\",{x:0,y:0,z:-1,diff:0.01,mag:1});\n");
  await page.waitForTimeout(1500);
  await sendCode(page, "MORSE.rec.stop();\nprint(\"marker\",require(\"Storage\").read(\"morse.rec.json\")===undefined?\"gone\":\"left\");\n");
  await page.waitForTimeout(500);
  await sendCode(page, pull.buildDumpCode(pull.patterns(dev.loadApp("mr-morse"))) + "\n");
  await expect.poll(() => /<<<DONE>>>/.test(serial()), { timeout: 10000 }).toBe(true);

  const out = serial();
  expect(out).not.toMatch(/Uncaught|^Error/m);
  expect(out).toMatch(/marker gone/);
  const dump = pull.parseDump(out);
  const file = dump.files.find((f) => f.name === "morse.remu.csv");
  expect(file && file.ok).toBe(true);
  const parsed = recording.parse(file.lines.join("\n"));
  expect(parsed.bad).toEqual([]);
  expect(parsed.header.label).toBe("emulator");
  expect(parsed.events.filter((e) => e.type === "tap").length).toBe(1);
  expect(parsed.events.filter((e) => e.type === "accel").length).toBeGreaterThanOrEqual(5);
  expect(parsed.stopped).not.toBeNull();
});

// The NUC's sync code (relay/core/watch-code.js) is tested in node against
// the Storage mock; this runs it on the real firmware, against a log the
// real engine format uses, including an event from before ids existed.
test("the NUC's sync dump and ack run on the real firmware", async ({ page }) => {
  const code = require("../../../relay/core/watch-code.js");
  const serial = captureSerial(page);
  await startEmulator(page);
  await sendCode(page,
    "require(\"Storage\").writeJSON(\"morse.json\",{symptom:\"Migraine\"});\n" +
    "require(\"Storage\").writeJSON(\"morse.log.json\",[{t:100,s:2,src:\"tap\"},{id:1,t:200,s:3,sym:\"Headache\",src:\"tap\"},{id:2,t:300,s:5,sym:\"Headache\",src:\"tap\"}]);\n" +
    "require(\"Storage\").writeJSON(\"morse.sync.json\",{acked:1,last:1});\n");
  await sendCode(page, code.buildDumpCode({ now: Math.round(Date.now() / 1000), tzHours: 1, limit: 200 }) + "\n");
  await expect.poll(() => /<<<DONE>>>/.test(serial()), { timeout: 10000 }).toBe(true);
  const out = serial();
  expect(out).not.toMatch(/Uncaught|^Error/m);
  const dump = code.parseDump(out);
  expect(dump.acked).toBe(1);
  expect(dump.events).toEqual([
    { id: 2, t: 300, s: 5, sym: "Headache" },
    { id: 3, t: 100, s: 2, sym: "Migraine" }
  ]);

  await sendCode(page, code.buildAckCode(3, 12345) + "\nprint(require(\"Storage\").read(\"morse.sync.json\"));\n");
  await expect.poll(() => /<<<ACKED 3>>>/.test(serial()), { timeout: 10000 }).toBe(true);
  await expect.poll(() => serial(), { timeout: 5000 }).toMatch(/\{"?acked"?:3,"?last"?:12345\}/);

  // The engine's cheap "anything unsent?" check reads the log as the
  // firmware wrote it (keys unquoted), at boot.
  await sendCode(page, "require(\"Storage\").write(\"morse.tapseq.js\"," + JSON.stringify(read("../../../lib/morse-protocol.js")) + ");\n");
  await sendCode(page, read("../boot.js") + "\nprint(\"unsent\",MORSE.unsent);\n");
  await expect.poll(() => serial(), { timeout: 5000 }).toMatch(/unsent false/);
  await sendCode(page, "require(\"Storage\").writeJSON(\"morse.log.json\",[{id:3,t:1,s:2,sym:\"A\",src:\"tap\"},{id:4,t:2,s:3,sym:\"A\",src:\"tap\"}]);\n" +
    read("../boot.js") + "\nprint(\"unsent\",MORSE.unsent);\n");
  await expect.poll(() => serial(), { timeout: 5000 }).toMatch(/unsent true/);
});
