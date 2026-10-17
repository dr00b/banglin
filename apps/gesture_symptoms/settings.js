(function(back) {
  var S = require("Storage");
  var FILE = "gsym.json";
  var timeUtils = require("time_utils");
  var DETECTORS = ["auto", "rule"];

  var settings = Object.assign({
    enabled: true,
    detector: "auto",
    tfThreshold: 0.8,
    enterDeg: 35,
    quietMs: 1500,
    highAccuracy: false,
    pauseInSleep: true,
    sleepStart: timeUtils.encodeTime({h: 23, m: 0}),
    sleepEnd: timeUtils.encodeTime({h: 7, m: 0})
  }, S.readJSON(FILE, 1) || {});

  function save() { S.writeJSON(FILE, settings); }

  function editTime(label, key) {
    var t = timeUtils.decodeTime(settings[key]);
    E.showMenu({
      "": { title: label },
      "< Back": buildMenu,
      /*LANG*/"Hour": {
        value: t.h, min: 0, max: 23, wrap: true,
        onchange: function(v) { t.h = v; settings[key] = timeUtils.encodeTime(t); save(); }
      },
      /*LANG*/"Minute": {
        value: t.m, min: 0, max: 59, step: 5, wrap: true,
        onchange: function(v) { t.m = v; settings[key] = timeUtils.encodeTime(t); save(); }
      }
    });
  }

  function buildMenu() {
    var m = {
      "": { title: /*LANG*/"Gesture Log" },
      "< Back": back,
      /*LANG*/"Detection": {
        value: !!settings.enabled,
        onchange: function(v) { settings.enabled = v; save(); }
      },
      /*LANG*/"Detector": {
        value: Math.max(0, DETECTORS.indexOf(settings.detector)), min: 0, max: DETECTORS.length - 1,
        format: function(v) { return [/*LANG*/"Auto", /*LANG*/"Rule only"][v]; },
        onchange: function(v) { settings.detector = DETECTORS[v]; save(); }
      },
      /*LANG*/"TF confidence": {
        value: Math.round(settings.tfThreshold * 100), min: 50, max: 95, step: 5,
        format: function(v) { return v + "%"; },
        onchange: function(v) { settings.tfThreshold = v / 100; save(); }
      },
      /*LANG*/"Twist angle": {
        value: settings.enterDeg, min: 20, max: 60, step: 5,
        format: function(v) { return v + "\xB0"; },
        onchange: function(v) { settings.enterDeg = v; save(); }
      },
      /*LANG*/"Count timeout": {
        value: settings.quietMs / 1000, min: 1, max: 3, step: 0.5,
        format: function(v) { return v.toFixed(1) + "s"; },
        onchange: function(v) { settings.quietMs = Math.round(v * 1000); save(); }
      },
      /*LANG*/"High accuracy": {
        value: !!settings.highAccuracy,
        onchange: function(v) { settings.highAccuracy = v; save(); }
      },
      /*LANG*/"Pause in sleep": {
        value: !!settings.pauseInSleep,
        onchange: function(v) { settings.pauseInSleep = v; save(); }
      },
      /*LANG*/"Sleep start": function() { editTime(/*LANG*/"Sleep start", "sleepStart"); },
      /*LANG*/"Sleep end": function() { editTime(/*LANG*/"Sleep end", "sleepEnd"); }
    };
    E.showMenu(m);
  }

  buildMenu();
})
