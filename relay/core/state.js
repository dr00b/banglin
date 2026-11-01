"use strict";

// Where banglin-sync keeps its config and Guava tokens, and how it writes
// them. Nothing here assumes a particular OS layout, so the same code runs
// under systemd on the NUC and in Termux on a phone.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// $BANGLIN_SYNC_HOME, else $XDG_STATE_HOME/banglin-sync, else
// ~/.local/state/banglin-sync.
function stateDir(env) {
  env = env || process.env;
  if (env.BANGLIN_SYNC_HOME) return env.BANGLIN_SYNC_HOME;
  const base = env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), ".local", "state");
  return path.join(base, "banglin-sync");
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

// Write to a temporary file, flush it, then rename over the target: a crash
// leaves either the old file or the new one, never half of each. Tokens and
// secrets live in these files, so they're private to the owner.
function writeJSONAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + process.pid + ".tmp";
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

const DEFAULTS = {
  guavaEnv: "test",              // "test" (sandbox) or "live"
  watch: "",                     // the watch's Bluetooth address, e.g. "F1:23:45:67:89:AB"
  transport: "bluez",
  intervalMin: 15,
  batchLimit: 200,               // events per sync; the rest go next cycle
  redirectUri: "",               // registered with Guava, e.g. https://nuc.tailnet.ts.net/oauth/callback
  callbackPort: 8787,            // where `auth` listens for that redirect (127.0.0.1)
  severityMap: { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10 },  // watch 1-5 to Guava 0-10
  notes: "Tapped on Bangle.js"
};

// config.json in the state folder, then environment variables on top, so
// secrets can come from a systemd EnvironmentFile instead of the file.
function loadConfig(env) {
  env = env || process.env;
  const dir = stateDir(env);
  const cfg = Object.assign({}, DEFAULTS, readJSON(path.join(dir, "config.json")) || {});
  if (env.GUAVA_CLIENT_ID) cfg.clientId = env.GUAVA_CLIENT_ID;
  if (env.GUAVA_CLIENT_SECRET) cfg.clientSecret = env.GUAVA_CLIENT_SECRET;
  if (env.GUAVA_ENV) cfg.guavaEnv = env.GUAVA_ENV;
  if (env.BANGLIN_WATCH) cfg.watch = env.BANGLIN_WATCH;
  cfg.dir = dir;
  cfg.tokenFile = path.join(dir, "tokens.json");
  return cfg;
}

// A token store backed by one file, for core/guava.js.
function fileTokenStore(file) {
  return {
    load: async function() { return readJSON(file); },
    save: async function(tokens) { writeJSONAtomic(file, tokens); }
  };
}

module.exports = { stateDir, readJSON, writeJSONAtomic, loadConfig, fileTokenStore, DEFAULTS };
