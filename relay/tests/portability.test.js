"use strict";

// Keeps core runnable on a phone under Termux: no node-ble, no fixed system
// paths, no Intl, and no assumptions about which transport delivers events.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const state = require("../core/state.js");
const { runCycle } = require("../core/cycle.js");
const cli = require("../core/cli.js");
const { createFakeGuava, memoryStore } = require("./fake-guava.js");
const { createGuava } = require("../core/guava.js");

const CORE = path.resolve(__dirname, "../core");
const coreFiles = () => fs.readdirSync(CORE).filter((f) => f.endsWith(".js"));

test("core loads without node-ble installed", function() {
  const js = "const M=require('module');const r=M._resolveFilename;" +
    "M._resolveFilename=function(n){if(n==='node-ble')throw new Error('blocked');return r.apply(this,arguments);};" +
    coreFiles().map((f) => "require(" + JSON.stringify(path.join(CORE, f)) + ");").join("") + "console.log('ok')";
  assert.strictEqual(execFileSync(process.execPath, ["-e", js]).toString().trim(), "ok");
});

test("core uses no fixed system paths or Linux-only services", function() {
  for (const f of coreFiles()) {
    const src = fs.readFileSync(path.join(CORE, f), "utf8");
    assert.doesNotMatch(src, /["'`]\/(var|etc|usr|opt|home|data|tmp)\//, f);
    assert.doesNotMatch(src, /systemctl|dbus|node-ble"\)|require\("node-ble/, f);
  }
});

test("the state folder follows BANGLIN_SYNC_HOME, then XDG_STATE_HOME, then home", function() {
  assert.strictEqual(state.stateDir({ BANGLIN_SYNC_HOME: "/x", XDG_STATE_HOME: "/y", HOME: "/z" }), "/x");
  assert.strictEqual(state.stateDir({ XDG_STATE_HOME: "/y", HOME: "/z" }), path.join("/y", "banglin-sync"));
  assert.strictEqual(state.stateDir({ HOME: "/data/data/com.termux/files/home" }),
    path.join("/data/data/com.termux/files/home", ".local", "state", "banglin-sync"));
});

test("state files are written atomically and private to the owner", function(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "banglin-state-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "sub", "tokens.json");
  state.writeJSONAtomic(file, { a: 1 });
  state.writeJSONAtomic(file, { a: 2 });
  assert.deepStrictEqual(state.readJSON(file), { a: 2 });
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ["tokens.json"], "no temp file left");
  if (process.platform !== "win32") assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(state.readJSON(path.join(dir, "missing.json")), null);
});

test("the cycle runs unchanged on a push-style transport", async function() {
  // A phone transport would hold events the watch pushed, and answer the ack
  // in its HTTP response instead of writing to the watch.
  const pushed = { acked: 0, events: [{ id: 1, t: 0, s: 2, sym: "A" }] };
  let answered = null, closed = false;
  const transport = {
    fetch: async () => pushed,
    ack: async (id) => { answered = id; return id; },
    close: async () => { closed = true; }
  };
  const fake = createFakeGuava(), store = memoryStore(fake.signedIn(Date.now() + 3600000));
  const guava = createGuava({ env: "test", clientId: "cid", clientSecret: "secret", store: store, fetch: fake.fetch });
  const r = await runCycle({ transport: transport, guava: guava, config: Object.assign({}, state.DEFAULTS, { watch: "W" }) });
  assert.deepStrictEqual([r.accepted, answered, closed], [1, 1, true]);
});

test("run --transport http reports it isn't built yet, without crashing", async function(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "banglin-sync-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = [];
  const code = await cli.main(["run", "--once", "--transport", "http"], { env: { BANGLIN_SYNC_HOME: dir }, log: (s) => out.push(s) });
  assert.strictEqual(code, 1);
  assert.match(out.join("\n"), /http transport .* isn't implemented yet/);
});

test("timestamps don't depend on Intl", function() {
  const js = "globalThis.Intl=undefined;" +
    "console.log(require(" + JSON.stringify(path.join(CORE, "entries.js")) + ").isoWithOffset(Date.UTC(2026,6,1,12)/1000))";
  const out = execFileSync(process.execPath, ["-e", js], { env: Object.assign({}, process.env, { TZ: "Europe/Paris" }) });
  assert.strictEqual(out.toString().trim(), "2026-07-01T14:00:00+02:00");
});
