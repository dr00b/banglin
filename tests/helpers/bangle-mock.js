"use strict";

function createStorageMock(initial) {
  var files = Object.assign({}, initial || {});
  return {
    files: files,
    read: function(name) { return files[name]; },
    write: function(name, data) { files[name] = data; return true; },
    writeJSON: function(name, data) { files[name] = JSON.stringify(data); return true; },
    readJSON: function(name, noErr) {
      var raw = files[name];
      if (raw == null) {
        if (noErr) return undefined;
        throw new Error("missing " + name);
      }
      try { return JSON.parse(raw); }
      catch (e) { if (noErr) return undefined; throw e; }
    },
    erase: function(name) { delete files[name]; },
    list: function(re) {
      return Object.keys(files).filter(function(n) { return !re || re.test(n); });
    },
    // StorageFile: append-only text file read back line by line.
    open: function(name, mode) {
      var pos = 0;
      if (mode === "w") files[name] = "";
      return {
        write: function(data) { files[name] = (files[name] || "") + data; },
        readLine: function() {
          var s = files[name] || "";
          if (pos >= s.length) return undefined;
          var nl = s.indexOf("\n", pos);
          var end = nl < 0 ? s.length : nl + 1;
          var line = s.substring(pos, end);
          pos = end;
          return line;
        },
        erase: function() { delete files[name]; }
      };
    }
  };
}

function install(overrides) {
  overrides = overrides || {};
  var storage = overrides.storage || createStorageMock(overrides.files || {});
  var listeners = {};
  var widgets = {};

  var Bangle = Object.assign({
    on: function(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
    removeListener: function(ev, cb) {
      if (!listeners[ev]) return;
      listeners[ev] = listeners[ev].filter(function(x) { return x !== cb; });
    },
    emit: function(ev) {
      var args = Array.prototype.slice.call(arguments, 1);
      (listeners[ev] || []).slice().forEach(function(cb) { cb.apply(null, args); });
    },
    setBarometerPower: function() { return true; },
    buzz: function() { return Promise.resolve(); },
    loadWidgets: function() {},
    drawWidgets: function() {},
    setUI: function() {},
    setOptions: function() {},
    setPollInterval: function() {},
    appRect: { x: 0, y: 24, w: 176, h: 152, x2: 175, y2: 175 }
  }, overrides.Bangle || {});

  var E = Object.assign({
    showMenu: function(m) { return m; },
    showMessage: function() {},
    showAlert: function() { return Promise.resolve(); },
    showPrompt: function() { return Promise.resolve(true); },
    clip: function(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  }, overrides.E || {});

  global.Bangle = Bangle;
  global.E = E;
  global.WIDGETS = widgets;
  global.g = overrides.g || {
    theme: { dark: true, fg: "#fff", bg: "#000" },
    clear: function() { return this; }, reset: function() { return this; },
    clearRect: function() { return this; },
    setPixel: function() { return this; },
    drawCircle: function() { return this; },
    setColor: function() { return this; },
    setFont: function() { return this; },
    setFontAlign: function() { return this; },
    stringWidth: function(s) { return String(s).length * 6; },
    drawString: function() { return this; },
    drawLine: function() { return this; },
    drawRect: function() { return this; },
    fillCircle: function() { return this; },
    fillRect: function() { return this; },
    fillPoly: function() { return this; }
  };
  global.BTN = 0;
  global.setWatch = function() {};
  global.load = function() {};

  var modules = Object.assign({
    Storage: storage,
    time_utils: {
      encodeTime: function(t) { return ((t.h || 0) * 3600 + (t.m || 0) * 60 + (t.s || 0)) * 1000; },
      decodeTime: function(ms) {
        var total = Math.floor(ms / 1000);
        return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
      },
      formatTime: function(ms) {
        var t = modules.time_utils.decodeTime(ms);
        return ("0" + t.h).slice(-2) + ":" + ("0" + t.m).slice(-2);
      },
      getCurrentTimeMillis: function() { var d = new Date(); return d.getHours() * 3600000 + d.getMinutes() * 60000; }
    },
    sched: { getAlarms: function() { return []; }, setAlarm: function() {}, reload: function() {} },
    locale: { date: function(d) { return d.toISOString(); } },
    buzz_menu: {}
  }, overrides.modules || {});

  var originalRequire = global.require;
  global.require = function(name) {
    if (modules[name]) return modules[name];
    if (originalRequire) return originalRequire(name);
    throw new Error("unknown module: " + name);
  };

  return {
    Bangle: Bangle,
    E: E,
    storage: storage,
    listeners: listeners,
    widgets: widgets,
    restore: function() {
      delete global.Bangle; delete global.E; delete global.WIDGETS;
      delete global.g; delete global.BTN; delete global.setWatch; delete global.load;
      if (originalRequire) global.require = originalRequire; else delete global.require;
    }
  };
}

module.exports = { install: install, createStorageMock: createStorageMock };
