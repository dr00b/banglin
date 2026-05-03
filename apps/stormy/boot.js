(function() {
  var S = require("Storage");
  var SETTINGS_FILE = "stormy.json";
  var LOG_FILE = "stormy.log.json";
  var MAX_LOG = 144;
  var SAMPLE_INTERVAL_MS = 10 * 60 * 1000;

  function loadSettings() {
    return Object.assign({
      enabled: true,
      pressureDropHpa3h: 3.0,
      tempSwingC6h: 6.0,
      humidityJumpPct6h: 20.0,
      precipNext3hMmPerH: 1.0,
      cooldownH: 6,
      usePhoneForecast: false,
      sleepStart: 23 * 3600000,
      sleepEnd: 7 * 3600000,
      lat: 0,
      lon: 0,
      alertPending: false,
      lastAlertMin: null,
      lastForecastFetchMin: null,
      lastPresleepDay: null
    }, S.readJSON(SETTINGS_FILE, 1) || {});
  }

  function saveSettings(s) { S.writeJSON(SETTINGS_FILE, s); }

  function loadLog() { return S.readJSON(LOG_FILE, 1) || []; }
  function saveLog(log) { S.writeJSON(LOG_FILE, log); }

  function appendLog(sample) {
    var log = loadLog();
    log.push(sample);
    while (log.length > MAX_LOG) log.shift();
    saveLog(log);
    return log;
  }

  function loadTrend() {
    try {
      var code = S.read("stormy.trend.js");
      if (!code) return null;
      // Declare module/exports locally so the UMD pattern's Espruino branch fires
      // (sets root.stormyTrend) rather than the Node.js branch (module.exports).
      var module, exports; // jshint ignore:line
      eval(code);
      return (typeof stormyTrend !== "undefined") ? stormyTrend : (global && global.stormyTrend) || null;
    } catch (e) { return null; }
  }

  function samplePressure(cb) {
    try { Bangle.setBarometerPower(true, "stormy"); } catch (e) { return cb(null); }
    var done = false;
    var handler = function(p) {
      if (done) return;
      done = true;
      Bangle.removeListener("pressure", handler);
      try { Bangle.setBarometerPower(false, "stormy"); } catch (e) {}
      cb(p);
    };
    Bangle.on("pressure", handler);
    setTimeout(function() {
      if (done) return;
      done = true;
      Bangle.removeListener("pressure", handler);
      try { Bangle.setBarometerPower(false, "stormy"); } catch (e) {}
      cb(null);
    }, 6000);
  }

  function buzzAlert() {
    Bangle.buzz(100).then(function() {
      setTimeout(function() { Bangle.buzz(200); }, 200);
      setTimeout(function() { Bangle.buzz(100); }, 600);
    });
  }

  function doSample() {
    var settings = loadSettings();
    if (!settings.enabled) return;
    var d = new Date(Date.now());
    var nowMs = d.getHours() * 3600000 + d.getMinutes() * 60000 + d.getSeconds() * 1000;
    if (isInSleepWindow(settings, nowMs)) return;
    samplePressure(function(p) {
      if (!p) return;
      var nowMin = Math.floor(Date.now() / 60000);
      var sample = {
        t: nowMin,
        p: p.pressure != null ? p.pressure : null,
        T: p.temperature != null ? p.temperature : null,
        h: null,
        pr: null
      };
      if (settings.usePhoneForecast && settings.cachedForecast) {
        try {
          var wf = loadWeatherFetch();
          if (wf) {
            var s = wf.sampleAtHour(settings.cachedForecast, nowMin);
            if (s) { sample.h = s.humidity; sample.pr = s.precip; }
          }
        } catch (e) {}
      }
      var log = appendLog(sample);

      var trend = loadTrend();
      if (!trend) return;
      var result = trend.detect({
        log: log, settings: settings, now: nowMin,
        lastAlertMin: settings.lastAlertMin,
        forecast: settings.cachedForecast
      });
      if (result.shouldBuzz) {
        settings.alertPending = true;
        settings.lastAlertMin = nowMin;
        saveSettings(settings);
        buzzAlert();
      }
    });
  }

  function isInSleepWindow(settings, nowMs) {
    var start = settings.sleepStart;
    var end = settings.sleepEnd;
    if (start == null || end == null) return false;
    if (start < end) return nowMs >= start && nowMs < end;
    return nowMs >= start || nowMs < end;
  }

  function loadWeatherFetch() {
    try {
      var code = S.read("stormy.wfetch.js");
      if (!code) return null;
      eval(code);
      return (typeof stormyWeather !== "undefined") ? stormyWeather : null;
    } catch (e) { return null; }
  }

  setInterval(doSample, SAMPLE_INTERVAL_MS);
  setTimeout(doSample, 5000);
})();
