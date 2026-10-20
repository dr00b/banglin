(function(back) {
  var S = require("Storage");
  var FILE = "gsym2.json";
  var timeUtils = require("time_utils");

  var settings = Object.assign({
    enabled: true,
    onlyWhenLocked: true,
    lockDuringCount: true,
    tapSens: 0,
    quietMs: 4000,
    waitMaxMs: 1500,
    muteMs: 300,
    pauseInSleep: false,
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
      "": { title: /*LANG*/"Tap Log" },
      "< Back": back,
      /*LANG*/"Detection": {
        value: !!settings.enabled,
        onchange: function(v) { settings.enabled = v; save(); }
      },
      /*LANG*/"Only if locked": {
        value: !!settings.onlyWhenLocked,
        onchange: function(v) { settings.onlyWhenLocked = v; save(); }
      },
      /*LANG*/"Lock to count": {
        value: !!settings.lockDuringCount,
        onchange: function(v) { settings.lockDuringCount = v; save(); }
      },
      // Raw accelerometer tap threshold. 0 leaves the firmware's own value
      // alone; which direction is more sensitive needs testing on the watch.
      /*LANG*/"Tap sens.": {
        value: settings.tapSens, min: 0, max: 0x50, step: 8,
        format: function(v) { return v ? "0x" + v.toString(16) : /*LANG*/"default"; },
        onchange: function(v) { settings.tapSens = v; save(); }
      },
      /*LANG*/"Count timeout": {
        value: settings.quietMs / 1000, min: 2, max: 8, step: 0.5,
        format: function(v) { return v.toFixed(1) + "s"; },
        onchange: function(v) { settings.quietMs = Math.round(v * 1000); save(); }
      },
      /*LANG*/"Confirm window": {
        value: settings.waitMaxMs / 1000, min: 0.6, max: 2, step: 0.1,
        format: function(v) { return v.toFixed(1) + "s"; },
        onchange: function(v) { settings.waitMaxMs = Math.round(v * 1000); save(); }
      },
      // How long the engine stays deaf after a buzz. Raise it if the
      // confirmation buzz ever counts itself as a tap.
      /*LANG*/"Buzz deaf time": {
        value: settings.muteMs / 1000, min: 0.1, max: 1, step: 0.1,
        format: function(v) { return v.toFixed(1) + "s"; },
        onchange: function(v) { settings.muteMs = Math.round(v * 1000); save(); }
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
