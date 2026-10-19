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
  const app = dev.loadApp("gesture_symptoms");
  const r = runOnFakeWatch(dev.buildInstall(app), { "bootupdate.js": "BOOTUPDATE" });
  for (const f of app.files) {
    assert.strictEqual(r.files[f.name], f.evaluate ? "IMG" : f.content, f.name + " stored intact");
  }
  assert.ok(r.files["gsym.counter.js"].includes("createCounter"), "../../lib file resolved");
  assert.deepStrictEqual(r.calls, [["eval", "BOOTUPDATE"], ["load", "gsym.app.js"]]);
});

test("large files are split into chunked writes that reassemble exactly", function() {
  const app = dev.loadApp("gesture_symptoms");
  const big = app.files.find((f) => f.name === "gsym.app.js");
  assert.ok(big.content.length > 2048);
  const code = dev.buildInstall(app, [big]);
  assert.ok((code.match(/Storage"\)\.write\("gsym\.app\.js"/g) || []).length > 2, "written in chunks");
  assert.strictEqual(runOnFakeWatch(code).files["gsym.app.js"], big.content);
});

test("evaluate entries store the expression's value, not its source", function() {
  const app = dev.loadApp("stormy");
  const icon = app.files.find((f) => f.evaluate);
  const code = dev.buildInstall(app, [icon]);
  assert.ok(code.includes("write(\"stormy.img\",(function()"), code.slice(0, 200));
});

test("only changed files: no boot rebuild unless a boot file is included", function() {
  const app = dev.loadApp("gesture_symptoms");
  const r = runOnFakeWatch(dev.buildInstall(app, app.files.filter((f) => f.name === "gsym.app.js")),
    { "bootupdate.js": "BOOTUPDATE" });
  assert.deepStrictEqual(r.calls, [["load", "gsym.app.js"]]);
});

test("RAM mode runs the installed boot file, then the app source", function() {
  const app = dev.loadApp("gesture_symptoms");
  const code = dev.buildRam(app);
  assert.ok(code.startsWith("// gesture_symptoms: gsym.app.js in RAM\neval(require(\"Storage\").read(\"gsym.boot.js\"));\n"));
  assert.ok(code.endsWith(app.files.find((f) => f.name === "gsym.app.js").content + "\n"));
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
  assert.deepStrictEqual(dev.parseArgs(["stormy", "--port", "Bangle", "--ram"]),
    { appId: "stormy", port: "Bangle", ram: true, once: false, dry: false });
  assert.throws(() => dev.parseArgs(["stormy"]), /--port is required/);
  assert.doesNotThrow(() => dev.parseArgs(["stormy", "--dry"]));
});
