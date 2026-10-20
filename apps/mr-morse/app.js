(function() {
  var S = require("Storage");
  var LOG_FILE = "morse.log.json";
  var GS = global.MORSE; // engine from morse.boot.js; undefined when detection is off

  function loadLog() { return S.readJSON(LOG_FILE, 1) || []; }
  function saveLog(log) { S.writeJSON(LOG_FILE, log); }

  function pad2(n) { return ("0" + n).substr(-2); }
  function fmtStamp(t) {
    var d = new Date(t * 1000);
    return d.getDate() + "/" + (d.getMonth() + 1) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  // Screens that take over the display register their teardown here.
  var teardown = null;
  function leave() {
    if (teardown) teardown();
    teardown = null;
  }

  function header(title) {
    var R = Bangle.appRect;
    g.reset().clearRect(R.x, R.y, R.x2, R.y2);
    g.setFont("6x8", 2);
    if (g.stringWidth(title) > R.w) g.setFont("6x8", 1);
    g.setFontAlign(0, -1).drawString(title, R.x + R.w / 2, R.y + 2);
    return R;
  }

  // --- Live test --------------------------------------------------------

  function showLive() {
    leave();
    if (!GS) {
      E.showAlert(/*LANG*/"Detection is off. Turn it on in Settings.").then(showMain);
      return;
    }
    var WINDOW = 8000;      // ms of tap history drawn

    function status() {
      if (GS.state === "counting") return /*LANG*/"Counting: " + GS.count;
      if (GS.state === "echo") return /*LANG*/"Confirming";
      if (GS.state === "waiting") return /*LANG*/"Now one tap";
      if (GS.state === "half") return /*LANG*/"Tap again";
      if (GS.last && GS.last.dry && Date.now() - GS.last.t < 8000) {
        return GS.last.severity ? /*LANG*/"Severity " + GS.last.severity : /*LANG*/"Cancelled";
      }
      return /*LANG*/"Tap x2, then x1";
    }

    function detail() {
      var lt = GS.lastTap;
      if (!lt) return /*LANG*/"No taps yet";
      return (lt.dir || "?") + " " + (lt.double ? /*LANG*/"double" : /*LANG*/"single") +
        (lt.skipped ? /*LANG*/" - ignored" : "");
    }

    function draw() {
      var R = header(status());
      g.setFont("6x8", 1).setFontAlign(0, -1).drawString(detail(), R.x + R.w / 2, R.y + 22);

      // Tap history: now at the right edge, WINDOW ms of past to the left.
      // Doubles are drawn full height, taps the engine ignored as dotted.
      var bot = R.y2 - 12, top = R.y + 44, now = Date.now(), span = R.w - 8;
      var taps = GS.taps || [];
      g.drawLine(R.x + 4, bot, R.x2 - 4, bot);
      for (var i = 0; i < taps.length; i++) {
        var age = now - taps[i].t;
        if (age > WINDOW) continue;
        var x = R.x2 - 4 - (age / WINDOW) * span;
        var h = taps[i].double ? bot - top : (bot - top) * 0.55;
        if (taps[i].skipped) {
          for (var y = bot - h; y < bot; y += 3) g.setPixel(x, y);
        } else {
          g.drawLine(x, bot - h, x, bot);
        }
      }
      g.setFontAlign(-1, 1).drawString("-8s", R.x + 2, R.y2);
      g.setFontAlign(1, 1).drawString(/*LANG*/"now", R.x2 - 2, R.y2);
    }

    GS.dryRun = true;
    GS.onUpdate = draw;
    var timer = setInterval(draw, 250);
    teardown = function() {
      clearInterval(timer);
      GS.dryRun = false;
      GS.onUpdate = null;
    };
    Bangle.setUI({ mode: "custom", back: showMain });
    draw();
  }

  // --- Event log --------------------------------------------------------

  function showLog() {
    leave();
    var log = loadLog();
    var menu = { "": { title: /*LANG*/"Events" }, "< Back": showMain };
    if (!log.length) menu[/*LANG*/"No events yet"] = function() {};
    for (var i = log.length - 1; i >= Math.max(0, log.length - 30); i--) {
      var key = fmtStamp(log[i].t) + "  " + log[i].s + "/5";
      while (menu[key]) key += " ";
      menu[key] = (function(idx) {
        return function() {
          E.showPrompt(/*LANG*/"Delete this event?").then(function(ok) {
            if (ok) { log.splice(idx, 1); saveLog(log); }
            showLog();
          });
        };
      })(i);
    }
    if (log.length) menu[/*LANG*/"Clear all"] = function() {
      E.showPrompt(/*LANG*/"Delete all events?").then(function(ok) {
        if (ok) saveLog([]);
        showLog();
      });
    };
    E.showMenu(menu);
  }

  // --- Main -------------------------------------------------------------

  function showMain() {
    leave();
    var menu = { "": { title: /*LANG*/"Mr Morse" }, "< Back": function() { load(); } };
    menu[/*LANG*/"Live test"] = showLive;
    menu[/*LANG*/"Events (" + loadLog().length + ")"] = showLog;
    menu[/*LANG*/"Detection"] = { value: GS ? /*LANG*/"on" : /*LANG*/"off" };
    // Settings are read by the boot code, so reload the app to apply them.
    menu[/*LANG*/"Settings"] = function() {
      eval(S.read("morse.settings.js"))(function() { load("morse.app.js"); });
    };
    E.showMenu(menu);
  }

  Bangle.loadWidgets();
  Bangle.drawWidgets();
  showMain();
})();
