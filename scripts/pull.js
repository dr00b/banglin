#!/usr/bin/env node
// Copy an app's StorageFile data (e.g. mr-morse field recordings) off the
// watch into apps/<appid>/tests/recordings, over Bluetooth.
//
// Usage:
//   npm run pull -- <appid> --port <device>           copy every recording
//   npm run pull -- <appid> --port <device> --erase   ...then, if all arrived intact,
//                                                     delete them from the watch
//
// Which files: the app's metadata.json "data" entries with "storageFile":
// true. The watch prints each one between markers with its line count, so a
// line lost on the way is caught rather than silently replayed. Fallback: the
// Web IDE's Storage view can save a StorageFile too.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const dev = require("./dev.js");

function wildcardToRegExp(w) {
  return new RegExp("^" + w.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}

function patterns(app) {
  return (app.meta.data || []).filter((d) => d.storageFile && d.wildcard).map((d) => wildcardToRegExp(d.wildcard));
}

// One line of JS for the watch: print every matching StorageFile between
// markers, then a final marker.
function buildDumpCode(regexps) {
  const re = regexps.map((r) => r.toString()).join(",");
  return "(function(){var S=require(\"Storage\");[" + re + "].forEach(function(re){" +
    "S.list(re,{sf:true}).forEach(function(n){var f=S.open(n,\"r\"),l,c=0;print(\"<<<FILE \"+n+\">>>\");" +
    "while((l=f.readLine())!==undefined){print(l.replace(/[\\r\\n]+$/,\"\"));c++;}" +
    "print(\"<<<END \"+n+\" \"+c+\">>>\");});});print(\"<<<DONE>>>\");})()";
}

function buildEraseCode(names) {
  return "(function(){var S=require(\"Storage\");" + JSON.stringify(names) +
    ".forEach(function(n){S.open(n,\"r\").erase();});print(\"<<<DONE>>>\");})()";
}

// Run code on the watch; resolves with the console output once it prints DONE.
function onWatch(port, code, done) {
  const cli = require.resolve("espruino/bin/espruino-cli.js");
  const child = spawn(process.execPath, [cli].concat(dev.portArgs(port), ["-e", code]));
  let out = "";
  child.stdout.on("data", function(d) {
    out += d;
    if (/<<<DONE>>>/.test(out)) child.kill();
  });
  child.stderr.pipe(process.stderr);
  child.on("exit", function() { done(out); });
}

// Pull the files back out of the console output. Each comes with the line
// count the watch saw; ok is false if what arrived doesn't match.
function parseDump(output) {
  const files = [];
  let cur = null;
  output.split(/\r?\n/).forEach(function(line) {
    const begin = /^<<<FILE (.+)>>>$/.exec(line), end = /^<<<END (.+) (\d+)>>>$/.exec(line);
    if (begin) cur = { name: begin[1], lines: [] };
    else if (end && cur) {
      cur.expected = +end[2];
      cur.ok = cur.lines.length === cur.expected;
      files.push(cur);
      cur = null;
    } else if (cur) cur.lines.push(line);
  });
  return { files: files, done: /^<<<DONE>>>$/m.test(output) };
}

function parseArgs(argv) {
  const o = { appId: null, port: null, erase: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") o.port = argv[++i];
    else if (a === "--erase") o.erase = true;
    else if (!a.startsWith("-") && !o.appId) o.appId = a;
    else throw new Error("unknown option " + a);
  }
  if (!o.appId || !o.port) throw new Error("usage: npm run pull -- <appid> --port <device> [--erase]");
  return o;
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const app = dev.loadApp(o.appId);
  const res = patterns(app);
  if (!res.length) { console.error(o.appId + " declares no StorageFile data"); process.exit(2); }
  const outDir = path.join(app.dir, "tests", "recordings");
  fs.mkdirSync(outDir, { recursive: true });

  onWatch(o.port, buildDumpCode(res), function(out) {
    const dump = parseDump(out);
    if (!dump.done) console.error("the watch didn't finish; what arrived is below");
    let bad = 0;
    dump.files.forEach(function(f) {
      const dest = path.join(outDir, f.name);
      fs.writeFileSync(dest, f.lines.join("\n") + "\n");
      console.log((f.ok ? "ok    " : "SHORT ") + path.relative(process.cwd(), dest) + " (" + f.lines.length + "/" + f.expected + " lines)");
      if (!f.ok) bad++;
    });
    if (!dump.files.length) console.log("no recordings on the watch");
    if (bad || !dump.done) process.exit(1);
    if (!o.erase || !dump.files.length) return;
    onWatch(o.port, buildEraseCode(dump.files.map((f) => f.name)), function() {
      console.log("erased " + dump.files.length + " from the watch");
    });
  });
}

module.exports = { wildcardToRegExp, patterns, buildDumpCode, buildEraseCode, parseDump, parseArgs };

if (require.main === module) main();
