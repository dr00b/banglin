"use strict";

// The banglin-sync command, with a temporary state folder.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cli = require("../core/cli.js");
const { createUartTransport } = require("../core/uart-transport.js");
const { createFakeWatch, events } = require("./fake-watch.js");
const { createFakeGuava } = require("./fake-guava.js");

function home(t, config, tokens) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "banglin-sync-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (config) fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
  if (tokens) fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify(tokens));
  return { BANGLIN_SYNC_HOME: dir, GUAVA_CLIENT_ID: "cid", GUAVA_CLIENT_SECRET: "secret" };
}

test("unknown commands and options print usage", async function() {
  const out = [];
  assert.strictEqual(await cli.main(["sync"], { log: (s) => out.push(s) }), 2);
  assert.strictEqual(await cli.main(["run", "--fast"], { log: (s) => out.push(s) }), 2);
  assert.match(out[0], /usage: banglin-sync run/);
  assert.match(out[1], /unknown option --fast/);
});

test("status shows the setup and sign-in state, never the secret", async function(t) {
  const env = home(t, { watch: "AA:BB:CC:DD:EE:FF" }, { refresh_token: "rt", expires_at: 0 });
  const out = [];
  assert.strictEqual(await cli.main(["status"], { env: env, log: (s) => out.push(s) }), 0);
  assert.match(out[0], /AA:BB:CC:DD:EE:FF via bluez/);
  assert.match(out[0], /signed in:\s+yes/);
  assert.doesNotMatch(out[0], /secret|\brt\b/);
});

test("run --once syncs through the chosen transport and saves rotated tokens", async function(t) {
  const fake = createFakeGuava();
  const env = home(t, { watch: "AA:BB:CC:DD:EE:FF" }, fake.signedIn(0)); // expired: forces a refresh
  const w = createFakeWatch({ files: { "morse.log.json": JSON.stringify(events(2)) } });
  t.after(w.restore);
  const out = [];
  const code = await cli.main(["run", "--once"], {
    env: env, fetch: fake.fetch, log: (s) => out.push(s),
    openTransport: async (name) => { assert.strictEqual(name, "bluez"); return createUartTransport(w.pipe()); }
  });
  assert.strictEqual(code, 0, out.join("\n"));
  assert.match(out[0], /synced: 2 sent, 2 new in Guava, watch acked to 2/);
  const saved = JSON.parse(fs.readFileSync(path.join(env.BANGLIN_SYNC_HOME, "tokens.json"), "utf8"));
  assert.strictEqual(saved.refresh_token, "rt2");
});

test("a watch out of range is logged and the run carries on", async function(t) {
  const env = home(t, {});
  const out = [];
  const code = await cli.main(["run", "--once"], {
    env: env, log: (s) => out.push(s),
    openTransport: async () => { throw new Error("watch AA not in range"); }
  });
  assert.strictEqual(code, 1);
  assert.match(out[0], /not in range/);
});
