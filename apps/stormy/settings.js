(function(back) {
  var S = require("Storage");
  var FILE = "stormy.json";
  var timeUtils = require("time_utils");

  var settings = Object.assign({
    enabled: true,
    pressureDropHpa3h: 3.0,
    tempSwingC6h: 6.0,
    humidityJumpPct6h: 20.0,
    precipNext3hMmPerH: 1.0,
    cooldownH: 6,
    usePhoneForecast: false,
    sleepStart: timeUtils.encodeTime({h: 23, m: 0}),
    sleepEnd: timeUtils.encodeTime({h: 7, m: 0}),
    lat: 0,
    lon: 0
  }, S.readJSON(FILE, 1) || {});

  function save() { S.writeJSON(FILE, settings); }

  function testBuzz() {
    Bangle.buzz(100).then(function() {
      setTimeout(function() { Bangle.buzz(200); }, 200);
      setTimeout(function() { Bangle.buzz(100); }, 600);
    });
  }

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

  function editLocation() {
    E.showMenu({
      "": { title: /*LANG*/"Location" },
      "< Back": buildMenu,
      /*LANG*/"Latitude": {
        value: settings.lat, min: -90, max: 90, step: 0.5,
        format: function(v) { return v.toFixed(1); },
        onchange: function(v) { settings.lat = v; save(); }
      },
      /*LANG*/"Longitude": {
        value: settings.lon, min: -180, max: 180, step: 0.5,
        format: function(v) { return v.toFixed(1); },
        onchange: function(v) { settings.lon = v; save(); }
      }
    });
  }

  function buildMenu() {
    var m = {
      "": { title: /*LANG*/"Stormy" },
      "< Back": back,
      /*LANG*/"Enabled": {
        value: !!settings.enabled,
        onchange: function(v) { settings.enabled = v; save(); }
      },
      /*LANG*/"P drop hPa/3h": {
        value: settings.pressureDropHpa3h, min: 0.5, max: 10, step: 0.5,
        format: function(v) { return v.toFixed(1); },
        onchange: function(v) { settings.pressureDropHpa3h = v; save(); }
      },
      /*LANG*/"T swing C/6h": {
        value: settings.tempSwingC6h, min: 1, max: 20, step: 0.5,
        format: function(v) { return v.toFixed(1); },
        onchange: function(v) { settings.tempSwingC6h = v; save(); }
      },
      /*LANG*/"Cooldown h": {
        value: settings.cooldownH, min: 1, max: 24, step: 1,
        onchange: function(v) { settings.cooldownH = v; save(); }
      },
      /*LANG*/"Sleep start": function() { editTime(/*LANG*/"Sleep start", "sleepStart"); },
      /*LANG*/"Sleep end":   function() { editTime(/*LANG*/"Sleep end",   "sleepEnd"); },
      /*LANG*/"Use phone fcst": {
        value: !!settings.usePhoneForecast,
        onchange: function(v) { settings.usePhoneForecast = v; save(); setTimeout(buildMenu, 10); }
      }
    };
    if (settings.usePhoneForecast) {
      m[/*LANG*/"RH jump %/6h"] = {
        value: settings.humidityJumpPct6h, min: 5, max: 50, step: 5,
        onchange: function(v) { settings.humidityJumpPct6h = v; save(); }
      };
      m[/*LANG*/"Precip mm/3h"] = {
        value: settings.precipNext3hMmPerH, min: 0.1, max: 10, step: 0.1,
        format: function(v) { return v.toFixed(1); },
        onchange: function(v) { settings.precipNext3hMmPerH = v; save(); }
      };
      m[/*LANG*/"Location"] = editLocation;
    }
    m[/*LANG*/"Test buzz"] = testBuzz;
    E.showMenu(m);
  }

  buildMenu();
})
