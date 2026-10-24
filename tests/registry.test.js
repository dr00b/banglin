"use strict";

// tests/REGISTRY.md lists every test in the repo and what it is for. This
// keeps it honest: add, rename or remove a test without updating the
// registry and npm test fails here, naming the entries to fix.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = path.join(__dirname, "REGISTRY.md");
// Apps still being written, left out of the registry until they're done.
const UNFINISHED = ["apps/stormy"];

function testFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name.endsWith("-snapshots")) continue;
      const p = path.join(dir, e.name);
      if (UNFINISHED.indexOf(path.relative(ROOT, p).split(path.sep).join("/")) >= 0) continue;
      if (e.isDirectory()) walk(p);
      else if (/\.(test|spec)\.js$/.test(e.name)) out.push(path.relative(ROOT, p).split(path.sep).join("/"));
    }
  })(ROOT);
  return out.sort();
}

// The first argument of every test(...) call, as written. Template-literal
// names keep their ${...} so one registry row covers every case they make.
function namesIn(file) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const re = /(?:^|[^.\w])test(?:\.skip|\.only)?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gm;
  const names = [];
  let m;
  while ((m = re.exec(src))) names.push(m[1] === "`" ? m[2] : m[2].replace(/\\(.)/g, "$1"));
  return names;
}

// "### path" headings, each followed by a table whose rows are
// | `test name` | purpose |
// Any other heading ends the section, so other tables can live in between.
function readRegistry() {
  const sections = {};
  let cur = null;
  fs.readFileSync(REGISTRY, "utf8").split("\n").forEach(function(line) {
    if (line[0] === "#") {
      const h = /^###\s+`?([^`]+?)`?\s*$/.exec(line);
      cur = h ? (sections[h[1]] = []) : null;
      return;
    }
    const row = /^\|\s*`(.+?)`\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (row && cur) cur.push({ name: row[1].replace(/\\\|/g, "|"), purpose: row[2] });
  });
  return sections;
}

test("every test is in the registry", function() {
  const reg = readRegistry(), missing = [];
  for (const f of testFiles()) {
    const listed = (reg[f] || []).map((r) => r.name);
    for (const n of namesIn(f)) if (listed.indexOf(n) < 0) missing.push(f + ": " + n);
  }
  assert.deepStrictEqual(missing, [], "add these to tests/REGISTRY.md");
});

test("the registry lists no test that no longer exists", function() {
  const reg = readRegistry(), files = testFiles(), stale = [];
  for (const f of Object.keys(reg)) {
    if (files.indexOf(f) < 0) { stale.push(f + " (file gone)"); continue; }
    const names = namesIn(f);
    for (const r of reg[f]) if (names.indexOf(r.name) < 0) stale.push(f + ": " + r.name);
  }
  assert.deepStrictEqual(stale, [], "remove or rename these in tests/REGISTRY.md");
});

test("every registry entry says what its test is for", function() {
  const reg = readRegistry(), empty = [];
  for (const f of Object.keys(reg)) for (const r of reg[f]) if (!r.purpose) empty.push(f + ": " + r.name);
  assert.deepStrictEqual(empty, []);
});
