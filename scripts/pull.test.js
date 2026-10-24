"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const pull = require("./pull.js");
const dev = require("./dev.js");
const mock = require(path.resolve(__dirname, "../tests/helpers/bangle-mock.js"));

// Run the code pull.js sends to the watch against a fake one, as the Espruino
// console would, and return what it printed.
function runOnFakeWatch(code, files) {
  const storage = mock.createStorageMock(files);
  const out = [];
  const fakeRequire = (m) => { if (m === "Storage") return storage; throw new Error(m); };
  new Function("require", "print", code)(fakeRequire, (s) => out.push(s));
  return { output: out.join("\r\n") + "\r\n", storage: storage };
}

test("the app's StorageFile data is what gets pulled", function() {
  const res = pull.patterns(dev.loadApp("mr-morse"));
  assert.strictEqual(res.length, 1);
  assert.ok(res[0].test("morse.rkq3x2a.csv"));
  assert.ok(!res[0].test("morse.rec.json") && !res[0].test("morse.log.json"));
});

test("dump and parse: every file comes back whole, with its line count checked", function() {
  const files = {
    "morse.r1.csv": "#{\"label\":\"typing\"}\na,0,0,0,-1000,2\nt,40,front,0\n",
    "morse.r2.csv": "#{\"label\":\"sleep\"}\n",
    "morse.log.json": "[]"
  };
  const r = runOnFakeWatch(pull.buildDumpCode(pull.patterns(dev.loadApp("mr-morse"))), files);
  const dump = pull.parseDump(r.output);
  assert.ok(dump.done);
  assert.deepStrictEqual(dump.files.map((f) => [f.name, f.ok, f.lines.length]), [["morse.r1.csv", true, 3], ["morse.r2.csv", true, 1]]);
  assert.strictEqual(dump.files[0].lines.join("\n") + "\n", files["morse.r1.csv"]);
  assert.ok(r.storage.files["morse.r1.csv"], "nothing erased by a plain pull");
});

test("a line lost on the way is caught", function() {
  const dump = pull.parseDump("<<<FILE morse.r1.csv>>>\r\n#{}\r\n<<<END morse.r1.csv 3>>>\r\n<<<DONE>>>\r\n");
  assert.strictEqual(dump.files[0].ok, false);
});

test("erase deletes exactly the files that were pulled", function() {
  const files = { "morse.r1.csv": "x\n", "morse.r2.csv": "y\n" };
  const r = runOnFakeWatch(pull.buildEraseCode(["morse.r1.csv"]), files);
  assert.deepStrictEqual(Object.keys(r.storage.files), ["morse.r2.csv"]);
});

test("pull arguments", function() {
  assert.deepStrictEqual(pull.parseArgs(["mr-morse", "--port", "Bangle", "--erase"]), { appId: "mr-morse", port: "Bangle", erase: true });
  assert.throws(() => pull.parseArgs(["mr-morse"]), /usage/);
});

test("wildcards match like the app loader's", function() {
  assert.ok(pull.wildcardToRegExp("app.*.csv").test("app.2024.csv"));
  assert.ok(!pull.wildcardToRegExp("app.*.csv").test("appX2024.csv"), "dots are literal");
});
