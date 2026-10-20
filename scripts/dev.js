#!/usr/bin/env node
// Fast edit -> watch loop. Installs an app straight from apps/<appid> onto a
// Bangle.js over Bluetooth, restarts it, streams the watch's console, and
// re-uploads whatever changed each time you save.
//
// Usage:
//   npm run dev -- <appid> --port <device>   install, then watch for changes
//   npm run dev -- <appid> --port <device> --ram
//                                            send app.js to RAM only (no flash
//                                            writes); boot code must already
//                                            be installed
//   npm run dev -- <appid> --port <device> --once
//                                            install once and exit
//   npm run dev -- <appid> --dry             write .dev/<appid>.js only, e.g.
//                                            to paste into the Web IDE
//
// <device> is a name fragment ("Bangle.js 1a2b"), a Bluetooth address, a
// serial port, or tcp://host. Find it with: npx espruino --list

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".dev");
const CHUNK = 1024; // chars per Storage.write, keeps each REPL line small

// Quote a source file as an Espruino string literal. Espruino strings are
// 8-bit, so bytes 0x80-0xFF become \x escapes and anything wider is an error.
function quote(text, file) {
  return JSON.stringify(text).replace(/[\u0080-￿]/g, (c) => {
    const n = c.charCodeAt(0);
    if (n > 0xff) throw new Error(file + ": character U+" + n.toString(16) + " can't be stored on the watch");
    return "\\x" + n.toString(16).padStart(2, "0");
  });
}

function loadApp(appId) {
  const dir = path.join(ROOT, "apps", appId);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8"));
  const files = meta.storage.map((s) => {
    const src = path.resolve(dir, s.url || s.name);
    return { name: s.name, src: src, evaluate: !!s.evaluate, content: fs.readFileSync(src, "utf8") };
  });
  return { id: appId, dir: dir, meta: meta, files: files };
}

function hash(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function writeFileCode(f) {
  if (f.evaluate) {
    // Same as the app loader: store the value the expression evaluates to.
    return "require(\"Storage\").write(" + JSON.stringify(f.name) + "," + f.content.trim() + ");\n";
  }
  const text = f.content;
  if (!text.length) return "";
  let code = "";
  for (let off = 0; off < text.length; off += CHUNK) {
    const part = quote(text.slice(off, off + CHUNK), f.src);
    code += off === 0
      ? "require(\"Storage\").write(" + JSON.stringify(f.name) + "," + part + ",0," + text.length + ");\n"
      : "require(\"Storage\").write(" + JSON.stringify(f.name) + "," + part + "," + off + ");\n";
  }
  return code;
}

// Upload script that installs `files` (default: all of the app's files) and
// restarts into the app. Boot code is rebuilt when a .boot.js file changes,
// as the app loader does after an install.
function buildInstall(app, files) {
  files = files || app.files;
  const appFile = app.files.find((f) => /\.app\.js$/.test(f.name));
  let code = "// " + app.id + ": " + files.map((f) => f.name).join(", ") + "\n";
  code += "E.showMessage(\"Uploading...\");\n";
  for (const f of files) code += writeFileCode(f);
  if (files.some((f) => /\.boot\.js$/.test(f.name))) {
    code += "if (require(\"Storage\").read(\"bootupdate.js\")) eval(require(\"Storage\").read(\"bootupdate.js\"));\n";
  }
  code += "load(" + (appFile ? JSON.stringify(appFile.name) : "") + ");\n";
  return code;
}

// Upload script that runs app.js from RAM. The upload resets the watch first,
// which skips boot code, so run the installed boot file before the app.
function buildRam(app) {
  const appFile = app.files.find((f) => /\.app\.js$/.test(f.name));
  if (!appFile) throw new Error(app.id + " has no .app.js to run");
  const boot = app.files.find((f) => /\.boot\.js$/.test(f.name));
  let code = "// " + app.id + ": " + appFile.name + " in RAM\n";
  if (boot) code += "eval(require(\"Storage\").read(" + JSON.stringify(boot.name) + "));\n";
  return code + appFile.content + "\n";
}

function parseArgs(argv) {
  const o = { appId: null, port: null, ram: false, once: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") o.port = argv[++i];
    else if (a === "--ram") o.ram = true;
    else if (a === "--once") o.once = true;
    else if (a === "--dry") o.dry = true;
    else if (!a.startsWith("-") && !o.appId) o.appId = a;
    else throw new Error("unknown option " + a);
  }
  if (!o.appId) throw new Error("usage: npm run dev -- <appid> --port <device> [--ram] [--once] [--dry]");
  if (!o.port && !o.dry) throw new Error("--port is required (find it with: npx espruino --list)");
  return o;
}

function portArgs(port) {
  // Addresses, serial ports and URLs connect directly; anything else is a
  // device-name fragment.
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(port) || /^(\/dev\/|COM\d|tcp:\/\/)/i.test(port)
    ? ["-p", port]
    : ["-d", port];
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, o.appId + ".js");

  let app = loadApp(o.appId);
  const sent = new Map(); // storage name -> hash of what's on the watch
  const build = () => {
    app = loadApp(o.appId);
    if (o.ram) return buildRam(app);
    const changed = app.files.filter((f) => sent.get(f.name) !== hash(f.content));
    if (!changed.length) return null;
    changed.forEach((f) => sent.set(f.name, hash(f.content)));
    return buildInstall(app, changed);
  };

  fs.writeFileSync(out, build());
  console.log("wrote " + path.relative(ROOT, out) + (o.ram ? " (RAM)" : " (" + app.files.length + " files)"));
  if (o.dry) return;

  const cli = require.resolve("espruino/bin/espruino-cli.js");
  const args = [cli].concat(portArgs(o.port), o.once ? [] : ["-w"], [out]);
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code || 0));
  if (o.once) return;

  // Rebuild on save; the CLI's own --watch sees the new bundle and uploads it.
  let timer = null;
  const onChange = (dir) => (event, file) => {
    if (!file || file.startsWith(".") || dir.endsWith("apps/" + o.appId) && file === "tests") return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      let code;
      try { code = build(); } catch (e) { console.error("[dev] " + e.message); return; }
      if (code === null) return;
      fs.writeFileSync(out, code);
      console.log("\n[dev] " + code.split("\n")[0].slice(3));
    }, 200);
  };
  const dirs = [app.dir].concat([...new Set(app.files.map((f) => path.dirname(f.src)))]);
  [...new Set(dirs)].forEach((d) => fs.watch(d, onChange(d)));
}

module.exports = { quote, loadApp, buildInstall, buildRam, parseArgs, portArgs };

if (require.main === module) main();
