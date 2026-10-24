"use strict";

const test = require("node:test");
const assert = require("node:assert");
const dev = require("./dev.js");

// Run an upload script against a fake watch and return what it did.
function runOnFakeWatch(code, files) {
  files = Object.assign({}, files);
  const calls = [];
  const Storage = {
    read: (n) => files[n],
    // Espruino semantics: write(name, data, offset, size) pre-sizes the file
    // on the first chunk; later chunks fill in at their offset.
    write: (n, data, offset, size) => {
      if (offset === undefined) { files[n] = data; return; }
      let cur = files[n] || "";
      if (size !== undefined) cur = " ".repeat(size);
      files[n] = cur.slice(0, offset) + data + cur.slice(offset + data.length);
    }
  };
  const fakeRequire = (m) => { if (m === "Storage") return Storage; throw new Error(m); };
  const E = { showMessage: () => {} };
  const load = (f) => calls.push(["load", f]);
  // eval of bootupdate.js is recorded rather than run.
  const evalFn = (src) => calls.push(["eval", src]);
  // Icons are drawn with Graphics; any chained call works, asImage gives a marker.
  const gfx = new Proxy({}, { get: (t, k) => k === "asImage" ? () => "IMG" : () => gfx });
  const Graphics = { createArrayBuffer: () => gfx };
  new Function("require", "E", "load", "eval", "Graphics", code)(fakeRequire, E, load, evalFn, Graphics);
  return { files: files, calls: calls };
}

test("install writes every storage entry and loads the app", function() {
  const app = dev.loadApp("mr-morse");
  const r = runOnFakeWatch(dev.buildInstall(app), { "bootupdate.js": "BOOTUPDATE" });
  for (const f of app.files) {
    assert.strictEqual(r.files[f.name], f.evaluate ? "IMG" : f.content, f.name + " stored intact");
  }
  assert.ok(r.files["morse.tapseq.js"].includes("createSequencer"), "../../lib file resolved");
  assert.deepStrictEqual(r.calls, [["eval", "BOOTUPDATE"], ["load", "morse.app.js"]]);
});

test("large files are split into chunked writes that reassemble exactly", function() {
  const app = dev.loadApp("mr-morse");
  const big = app.files.find((f) => f.name === "morse.app.js");
  assert.ok(big.content.length > 2048);
  const code = dev.buildInstall(app, [big]);
  assert.ok((code.match(/Storage"\)\.write\("morse\.app\.js"/g) || []).length > 2, "written in chunks");
  assert.strictEqual(runOnFakeWatch(code).files["morse.app.js"], big.content);
});

test("evaluate entries store the expression's value, not its source", function() {
  const app = dev.loadApp("mr-morse");
  const icon = app.files.find((f) => f.evaluate);
  const code = dev.buildInstall(app, [icon]);
  assert.ok(code.includes("write(\"morse.img\",(function()"), code.slice(0, 200));
});

test("only changed files: no boot rebuild unless a boot file is included", function() {
  const app = dev.loadApp("mr-morse");
  const r = runOnFakeWatch(dev.buildInstall(app, app.files.filter((f) => f.name === "morse.app.js")),
    { "bootupdate.js": "BOOTUPDATE" });
  assert.deepStrictEqual(r.calls, [["load", "morse.app.js"]]);
});

test("RAM mode runs the installed boot file, then the app source", function() {
  const app = dev.loadApp("mr-morse");
  const code = dev.buildRam(app);
  assert.ok(code.startsWith("// mr-morse: morse.app.js in RAM\neval(require(\"Storage\").read(\"morse.boot.js\"));\n"));
  assert.ok(code.endsWith(app.files.find((f) => f.name === "morse.app.js").content + "\n"));
  assert.ok(!/Storage"\)\.write/.test(code.split("\n").slice(0, 3).join("\n")), "no flash writes before the app");
});

test("quote escapes high bytes and rejects wide characters", function() {
  assert.strictEqual(dev.quote("a°b"), "\"a\\xb0b\"");
  assert.throws(() => dev.quote("☃", "x.js"), /U\+2603/);
});

test("port argument picks address vs device-name connection", function() {
  assert.deepStrictEqual(dev.portArgs("aa:bb:cc:dd:ee:ff"), ["-p", "aa:bb:cc:dd:ee:ff"]);
  assert.deepStrictEqual(dev.portArgs("/dev/ttyACM0"), ["-p", "/dev/ttyACM0"]);
  assert.deepStrictEqual(dev.portArgs("Bangle.js 1a2b"), ["-d", "Bangle.js 1a2b"]);
});

test("argument parsing", function() {
  assert.deepStrictEqual(dev.parseArgs(["mr-morse", "--port", "Bangle", "--ram"]),
    { appId: "mr-morse", port: "Bangle", ram: true, once: false, dry: false });
  assert.throws(() => dev.parseArgs(["mr-morse"]), /--port is required/);
  assert.doesNotThrow(() => dev.parseArgs(["mr-morse", "--dry"]));
});
