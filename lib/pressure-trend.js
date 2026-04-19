(function(root) {
  var DEFAULT_SETTINGS = {
    pressureDropHpa3h: 3.0,
    tempSwingC6h: 6.0,
    humidityJumpPct6h: 20.0,
    precipNext3hMmPerH: 1.0,
    cooldownH: 6,
    usePhoneForecast: false
  };

  function mergeSettings(s) {
    var out = {}, k;
    for (k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
    if (s) for (k in s) if (s[k] !== undefined) out[k] = s[k];
    return out;
  }

  function sampleAt(log, targetMin, maxDriftMin) {
    if (!log || !log.length) return null;
    var best = null, bestDrift = maxDriftMin + 1;
    for (var i = 0; i < log.length; i++) {
      var d = Math.abs(log[i].t - targetMin);
      if (d < bestDrift) { best = log[i]; bestDrift = d; }
    }
    return best;
  }

  function latest(log) {
    if (!log || !log.length) return null;
    var best = log[0];
    for (var i = 1; i < log.length; i++) if (log[i].t > best.t) best = log[i];
    return best;
  }

  function fieldDelta(log, nowMin, hoursBack, field) {
    var cur = latest(log);
    if (!cur || cur[field] == null) return null;
    var past = sampleAt(log, nowMin - hoursBack * 60, 30);
    if (!past || past[field] == null) return null;
    return cur[field] - past[field];
  }

  function precipNext3h(forecast, nowMin) {
    if (!forecast || !forecast.hourly || !forecast.hourly.time) return null;
    var times = forecast.hourly.time;
    var precip = forecast.hourly.precipitation;
    if (!precip) return null;
    var max = 0, found = false;
    for (var i = 0; i < times.length; i++) {
      var tMin = Math.floor(new Date(times[i]).getTime() / 60000);
      if (tMin < nowMin) continue;
      if (tMin > nowMin + 180) break;
      if (precip[i] != null) {
        found = true;
        if (precip[i] > max) max = precip[i];
      }
    }
    return found ? max : null;
  }

  function detect(opts) {
    var settings = mergeSettings(opts && opts.settings);
    var log = (opts && opts.log) || [];
    var now = (opts && opts.now != null) ? opts.now : Math.floor(Date.now() / 60000);
    var lastAlert = opts && opts.lastAlertMin;
    var forecast = opts && opts.forecast;

    var fired = [];

    var dp = fieldDelta(log, now, 3, "p");
    if (dp != null && dp <= -settings.pressureDropHpa3h) fired.push("pressure");

    var dT = fieldDelta(log, now, 6, "T");
    if (dT != null && Math.abs(dT) >= settings.tempSwingC6h) fired.push("temperature");

    if (settings.usePhoneForecast) {
      var dh = fieldDelta(log, now, 6, "h");
      if (dh != null && Math.abs(dh) >= settings.humidityJumpPct6h) fired.push("humidity");

      var pMax = precipNext3h(forecast, now);
      if (pMax != null && pMax >= settings.precipNext3hMmPerH) fired.push("precipitation");
    }

    var cooldownMin = settings.cooldownH * 60;
    var cooled = lastAlert == null || (now - lastAlert) >= cooldownMin;

    return {
      fired: fired,
      anyFired: fired.length > 0,
      shouldBuzz: fired.length > 0 && cooled,
      deltas: { p3h: dp, T6h: dT, precipNext3h: precipNext3h(forecast, now) }
    };
  }

  function summarize(log) {
    var cur = latest(log);
    if (!cur) return { p: null, T: null, h: null, trend: "unknown" };
    var now = cur.t;
    var dp = fieldDelta(log, now, 3, "p");
    var trend = "steady";
    if (dp != null) {
      if (dp <= -1) trend = "falling";
      else if (dp >= 1) trend = "rising";
    }
    return {
      p: cur.p, T: cur.T, h: cur.h, pr: cur.pr,
      dp3h: dp,
      dT6h: fieldDelta(log, now, 6, "T"),
      dh6h: fieldDelta(log, now, 6, "h"),
      trend: trend
    };
  }

  var api = {
    detect: detect,
    summarize: summarize,
    latest: latest,
    precipNext3h: precipNext3h,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.stormyTrend = api;
})(typeof global !== "undefined" ? global : this);
