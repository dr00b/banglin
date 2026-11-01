"use strict";

// banglin-sync commands. bin/banglin-sync is a shim over main().
//
//   run [--once] [--transport bluez|http]   sync now, then every intervalMin
//   auth [--paste]                          sign in to Guava (once)
//   status                                  config and sign-in state, no secrets

const http = require("node:http");
const readline = require("node:readline");
const state = require("./state.js");
const { createGuava } = require("./guava.js");
const { runCycle } = require("./cycle.js");
const { openTransport } = require("./transports.js");

function parseArgs(argv) {
  const o = { cmd: argv[0], once: false, paste: false, transport: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") o.once = true;
    else if (a === "--paste") o.paste = true;
    else if (a === "--transport") o.transport = argv[++i];
    else throw new Error("unknown option " + a);
  }
  if (["run", "auth", "status"].indexOf(o.cmd) < 0) {
    throw new Error("usage: banglin-sync run [--once] [--transport bluez|http] | auth [--paste] | status");
  }
  return o;
}

function guavaFor(cfg, deps) {
  return createGuava({
    env: cfg.guavaEnv, clientId: cfg.clientId, clientSecret: cfg.clientSecret,
    store: state.fileTokenStore(cfg.tokenFile), fetch: deps.fetch
  });
}

function stamp() { return new Date().toISOString(); }

// guava is a function returning the client, so a missing transport is
// reported before missing Guava credentials.
async function syncOnce(cfg, guava, transportName, log, open) {
  let transport;
  try {
    transport = await open(transportName, cfg);
  } catch (e) {
    log(stamp() + " " + e.message);
    return { ok: false, error: e };
  }
  let client;
  try {
    client = guava();
  } catch (e) {
    await transport.close();
    log(stamp() + " " + e.message);
    return { ok: false, error: e };
  }
  try {
    const r = await runCycle({ transport: transport, guava: client, config: cfg });
    log(stamp() + " synced: " + r.fetched + " sent, " + r.accepted + " new in Guava, watch acked to " + r.acked);
    return { ok: true, result: r };
  } catch (e) {
    log(stamp() + " sync failed: " + e.message);
    return { ok: false, error: e };
  }
}

async function run(o, cfg, deps) {
  let client = null;
  const guava = () => client || (client = guavaFor(cfg, deps)), name = o.transport || cfg.transport;
  const open = deps.openTransport || openTransport;
  const first = await syncOnce(cfg, guava, name, deps.log, open);
  if (o.once) return first.ok ? 0 : 1;
  let busy = false; // a slow sync must not overlap the next one
  setInterval(function() {
    if (busy) return;
    busy = true;
    syncOnce(cfg, guava, name, deps.log, open).finally(function() { busy = false; });
  }, cfg.intervalMin * 60000);
  return new Promise(function() {}); // runs until stopped
}

// Waits for Guava's redirect on 127.0.0.1, at the path of redirectUri (which
// `tailscale serve` or an SSH tunnel forwards here). Resolves {code, state}.
function waitForRedirect(cfg) {
  const path = new URL(cfg.redirectUri).pathname;
  return new Promise(function(resolve, reject) {
    const server = http.createServer(function(req, res) {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== path) { res.writeHead(404).end(); return; }
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/plain" })
        .end(err ? "Guava said: " + err + "\n" : "Signed in. You can close this tab.\n");
      server.close();
      if (err) reject(new Error("Guava refused: " + err));
      else resolve({ code: u.searchParams.get("code"), state: u.searchParams.get("state") });
    });
    server.on("error", reject);
    server.listen(cfg.callbackPort, "127.0.0.1");
  });
}

function askForRedirect() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(function(resolve) {
    rl.question("Paste the full address Guava sent your browser to: ", function(answer) {
      rl.close();
      const u = new URL(answer.trim());
      resolve({ code: u.searchParams.get("code"), state: u.searchParams.get("state") });
    });
  });
}

async function auth(o, cfg, deps) {
  if (!cfg.redirectUri) throw new Error("set redirectUri in config.json to the redirect URI registered with Guava");
  const guava = guavaFor(cfg, deps);
  const start = await guava.startAuthorization({ redirectUri: cfg.redirectUri });
  deps.log("Open this in a browser within " + Math.round((start.expiresIn || 600) / 60) + " minutes:\n\n  " + start.url + "\n");
  const back = o.paste ? await askForRedirect() : await waitForRedirect(cfg);
  const t = await guava.finishAuthorization({
    code: back.code, state: back.state, expectedState: start.state,
    verifier: start.verifier, redirectUri: cfg.redirectUri
  });
  deps.log("Signed in to Guava (" + cfg.guavaEnv + "), scopes: " + t.scope);
  return 0;
}

function status(cfg, deps) {
  const t = state.readJSON(cfg.tokenFile);
  deps.log([
    "state folder: " + cfg.dir,
    "guava:        " + cfg.guavaEnv + (cfg.clientId ? "" : " (no client id!)") + (cfg.clientSecret ? "" : " (no client secret!)"),
    "watch:        " + (cfg.watch || "(not set)") + " via " + cfg.transport,
    "interval:     " + cfg.intervalMin + " min",
    "signed in:    " + (t && t.refresh_token ? "yes, access token until " + new Date(t.expires_at).toISOString() : "no")
  ].join("\n"));
  return 0;
}

async function main(argv, deps) {
  deps = Object.assign({ log: console.log, env: process.env }, deps || {});
  let o;
  try { o = parseArgs(argv); } catch (e) { deps.log(e.message); return 2; }
  const cfg = state.loadConfig(deps.env);
  try {
    if (o.cmd === "status") return status(cfg, deps);
    if (o.cmd === "auth") return await auth(o, cfg, deps);
    return await run(o, cfg, deps);
  } catch (e) {
    deps.log(e.message);
    return 1;
  }
}

module.exports = { main, parseArgs, syncOnce };
