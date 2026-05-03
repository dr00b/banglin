(function() {
  var S = require("Storage");
  var SETTINGS_FILE = "stormy.json";
  var LOG_FILE = "stormy.log.json";

  function loadSettings() {
    return Object.assign({
      enabled: true,
      usePhoneForecast: false,
      alertPending: false
    }, S.readJSON(SETTINGS_FILE, 1) || {});
  }
  function saveSettings(s) { S.writeJSON(SETTINGS_FILE, s); }
  function loadLog() { return S.readJSON(LOG_FILE, 1) || []; }

  function loadTrend() {
    try {
      var code = S.read("stormy.trend.js");
      if (!code) return null;
      var module, exports; // jshint ignore:line
      eval(code);
      return (typeof stormyTrend !== "undefined") ? stormyTrend : (global && global.stormyTrend) || null;
    } catch (e) { return null; }
  }

  function fmt(v, digits) {
    if (v == null) return "--";
    return v.toFixed(digits != null ? digits : 1);
  }
  function fmtDelta(v, digits) {
    if (v == null) return "--";
    var d = digits != null ? digits : 1;
    return (v >= 0 ? "+" : "") + v.toFixed(d);
  }

  function showTrendGraph() {
    var log = loadLog();
    g.clear();
    Bangle.drawWidgets();
    g.setFont("6x8", 1);
    g.setFontAlign(0, -1);
    g.drawString(/*LANG*/"Pressure (24h)", 120, 28);
    if (log.length < 2) {
      g.drawString(/*LANG*/"Not enough data", 120, 110);
      Bangle.setUI("updown", function() { showMenu(); });
      return;
    }
    var x0 = 20, y0 = 180, w = 200, h = 120;
    var minP = log[0].p, maxP = log[0].p;
    for (var i = 1; i < log.length; i++) {
      if (log[i].p < minP) minP = log[i].p;
      if (log[i].p > maxP) maxP = log[i].p;
    }
    if (maxP - minP < 1) { maxP = minP + 1; }
    var tMin = log[0].t, tMax = log[log.length-1].t;
    if (tMax === tMin) tMax = tMin + 1;
    g.setColor(g.theme.fg);
    g.drawRect(x0, y0 - h, x0 + w, y0);
    g.setColor("#3377cc");
    var px = null, py = null;
    for (var j = 0; j < log.length; j++) {
      var lx = x0 + Math.round((log[j].t - tMin) * w / (tMax - tMin));
      var ly = y0 - Math.round((log[j].p - minP) * h / (maxP - minP));
      if (px != null) g.drawLine(px, py, lx, ly);
      px = lx; py = ly;
    }
    g.setColor(g.theme.fg);
    g.setFont("6x8", 1);
    g.setFontAlign(-1, -1);
    g.drawString(fmt(maxP) + " hPa", x0, y0 - h - 10);
    g.drawString(fmt(minP) + " hPa", x0, y0 + 2);
    g.setFontAlign(0, -1);
    g.drawString(/*LANG*/"Swipe or press to return", 120, 200);
    Bangle.setUI("updown", function() { showMenu(); });
  }

  function testBuzz() {
    E.showMessage(/*LANG*/"Buzzing...", "Stormy");
    Bangle.buzz(100).then(function() {
      setTimeout(function() { Bangle.buzz(200); }, 200);
      setTimeout(function() { Bangle.buzz(100); }, 600);
      setTimeout(showMenu, 1200);
    });
  }

  function dismissAlert() {
    var s = loadSettings();
    s.alertPending = false;
    saveSettings(s);
    if (typeof WIDGETS !== "undefined" && WIDGETS.stormy) WIDGETS.stormy.draw.call(WIDGETS.stormy);
    E.showMessage(/*LANG*/"Alert cleared", "Stormy");
    setTimeout(showMenu, 800);
  }

  function showMenu() {
    var settings = loadSettings();
    var trend = loadTrend();
    var log = loadLog();
    var summary = trend ? trend.summarize(log) : { p: null, T: null, h: null, trend: "--", dp3h: null, dT6h: null, dh6h: null };

    var title = /*LANG*/"Stormy";
    if (settings.alertPending) title += " !";

    var menu = {
      "": { title: title }
    };
    menu[/*LANG*/"P " + fmt(summary.p, 1) + " hPa"] = { value: fmtDelta(summary.dp3h) + "/3h" };
    menu[/*LANG*/"T " + fmt(summary.T, 1) + " C"] = { value: fmtDelta(summary.dT6h) + "/6h" };
    if (settings.usePhoneForecast && summary.h != null) {
      menu[/*LANG*/"RH " + fmt(summary.h, 0) + "%"] = { value: fmtDelta(summary.dh6h, 0) + "/6h" };
    }
    menu[/*LANG*/"Trend"] = { value: summary.trend };
    menu[/*LANG*/"View graph"] = showTrendGraph;
    if (settings.alertPending) menu[/*LANG*/"Dismiss alert"] = dismissAlert;
    menu[/*LANG*/"Test buzz"] = testBuzz;
    menu[/*LANG*/"Settings"] = function() {
      eval(require("Storage").read("stormy.settings.js"))(showMenu);
    };
    menu[/*LANG*/"Exit"] = function() { load(); };
    E.showMenu(menu);
  }

  Bangle.loadWidgets();
  Bangle.drawWidgets();
  showMenu();
})();
