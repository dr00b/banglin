"use strict";

// A watch for the relay tests: runs the code banglin-sync sends against the
// Bangle mock's Storage, and answers through a pipe the way the Bluetooth
// console does, prompt characters and 20-byte packets included.

const path = require("node:path");
const mock = require(path.resolve(__dirname, "../../tests/helpers/bangle-mock.js"));

// opts: {files, clock: unix seconds}
function createFakeWatch(opts) {
  opts = opts || {};
  const w = { clock: opts.clock || 1767225600, tz: null, codes: [], closed: 0, swallow: null };
  const h = mock.install({ files: opts.files || {}, E: { setTimeZone: function(tz) { w.tz = tz; } } });
  w.storage = h.storage;
  w.restore = h.restore;
  w.log = function() { return h.storage.readJSON("morse.log.json", 1) || []; };
  w.sync = function() { return h.storage.readJSON("morse.sync.json", 1) || {}; };

  // Run one console line. Returns what it printed.
  w.run = function(js) {
    let out = "";
    new Function("print", "getTime", "setTime", js)(
      function() { out += Array.prototype.join.call(arguments, " ") + "\r\n"; },
      function() { return w.clock; },
      function(t) { w.clock = t; });
    return out;
  };

  w.pipe = function() {
    let cb = function() {};
    return {
      write: async function(s) {
        if (s[0] !== "\x10" || s[s.length - 1] !== "\n") throw new Error("not a console line: " + JSON.stringify(s));
        const js = s.slice(1, -1);
        w.codes.push(js);
        const out = ">" + w.run(js) + ">";
        if (w.swallow && w.swallow(js)) return; // ran, but the answer is lost
        setImmediate(function() { for (let i = 0; i < out.length; i += 20) cb(out.slice(i, i + 20)); });
      },
      onData: function(f) { cb = f; },
      close: async function() { w.closed++; }
    };
  };
  return w;
}

// n events with ids 1..n, a minute apart.
function events(n, from) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ id: (from || 0) + i, t: 1767225600 + i * 60, s: (i % 5) + 1, sym: "Headache", src: "tap" });
  return out;
}

module.exports = { createFakeWatch, events };
