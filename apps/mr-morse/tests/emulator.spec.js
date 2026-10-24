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
