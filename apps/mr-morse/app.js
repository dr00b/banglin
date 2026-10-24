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
    if (GS.recording) {
      // The Live test changes how the engine behaves; it would spoil the recording.
      E.showAlert(/*LANG*/"Stop the field test first.").then(showMain);
      return;
    }
    var WINDOW = 8000;      // ms of tap history drawn
    var WHY = {
      busy: /*LANG*/"Not from quiet",
      rhythm: /*LANG*/"Wrong rhythm",
      after: /*LANG*/"Tap after end",
      moving: /*LANG*/"Wrist moving",
      direction: /*LANG*/"Wrong direction"
    };

    function status() {
      if (GS.state === "counting") return /*LANG*/"Counting: " + GS.count;
      if (GS.state === "echo") return /*LANG*/"Confirming";
      if (GS.state === "confirm") return /*LANG*/"Hold still";
      if (GS.state === "waiting") return /*LANG*/"Now one tap";
      if (GS.state === "half") return /*LANG*/"Tap again";
      if (GS.last && GS.last.dry && Date.now() - GS.last.t < 8000) {
        return GS.last.severity ? /*LANG*/"Severity " + GS.last.severity : /*LANG*/"Cancelled";
      }
      var r = GS.rejected;
      if (r && Date.now() - r.t < 3000) return WHY[r.reason] || r.reason;
      return /*LANG*/"Tap x2, then x1";
    }

    function detail() {
      var lt = GS.lastTap;
      if (!lt) return /*LANG*/"No taps yet";
      return (lt.dir || "?") + " " + (lt.double ? /*LANG*/"double" : /*LANG*/"single") +
        (lt.skipped ? " - " + (lt.why || /*LANG*/"ignored") : "") +
        (typeof GS.motion === "number" ? " " + /*LANG*/"move " + GS.motion.toFixed(2) : "");
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

  // --- Field test -------------------------------------------------------
  // Records a real session so it can be replayed through the same engine in
  // node and compared (FIELD-TESTS.md). The session names match the
  // simulated scenarios in tests/scenarios.js.

  var SESSIONS = [
    "burp-pat", "burp-hold", "bouncing", "swing-knock", "door-knock", "clapping",
    "typing", "drumming", "driving", "walking", "running", "chores", "sleep", "day-mix",
    "password-seated", "password-held", "password-in-bed", "password-after-typing",
    "password-after-rest", "password-walking"
  ];
  var field = { session: 0, minutes: 10, severity: 3, attempts: 5 };

  function recordings() {
    return S.list(/^morse\.r.*\.csv$/, { sf: true });
  }

  function recordingLabel(name) {
    try {
      var h = JSON.parse(S.open(name, "r").readLine().substr(1));
      return h.label + " " + h.minutes + "m";
    } catch (e) {
      return name;
    }
  }

  function startRecording() {
    var label = SESSIONS[field.session], intent = label.indexOf("password") === 0;
    // ~25 bytes a line at 12.5 lines a second, with room to spare.
    if (S.getFree && S.getFree() < field.minutes * 60 * 400 * 2) {
      E.showAlert(/*LANG*/"Not enough storage").then(showField);
      return;
    }
    var start = Date.now();
    var rec = {
      file: "morse.r" + Math.floor(start / 1000).toString(36) + ".csv",
      start: start, until: start + field.minutes * 60000, label: label
    };
    var header = {
      v: 1, label: label, expect: intent ? "logs" : "silent",
      severity: intent ? field.severity : undefined, attempts: intent ? field.attempts : undefined,
      start: start, minutes: field.minutes, settings: GS.settings,
      fw: process.env.VERSION
    };
    S.open(rec.file, "w").write("#" + JSON.stringify(header) + "\n");
    S.writeJSON("morse.rec.json", rec);
    eval(S.read("morse.rec.js"))(GS, rec, true);
    E.showAlert(intent
      ? /*LANG*/"Recording. Lock the watch, then tap the password and " + field.severity + " x" + field.attempts
      : /*LANG*/"Recording. Lock the watch and go.").then(showMain);
  }

  function showRecordings() {
    leave();
    var menu = { "": { title: /*LANG*/"Recordings" }, "< Back": showField };
    var list = recordings();
    if (!list.length) menu[/*LANG*/"None yet"] = function() {};
    list.forEach(function(name) {
      menu[recordingLabel(name)] = function() {
        E.showPrompt(/*LANG*/"Delete " + name + "?").then(function(ok) {
          if (ok) S.open(name, "r").erase();
          showRecordings();
        });
      };
    });
    E.showMenu(menu);
  }

  function showField() {
    leave();
    if (!GS) {
      E.showAlert(/*LANG*/"Detection is off. Turn it on in Settings.").then(showMain);
      return;
    }
    var menu = { "": { title: /*LANG*/"Field test" }, "< Back": showMain };
    if (GS.rec) {
      var left = Math.max(0, Math.round((GS.rec.until - Date.now()) / 60000));
      menu[GS.rec.label] = { value: left + /*LANG*/" min left" };
      menu[/*LANG*/"Stop now"] = function() { GS.rec.stop(); showField(); };
    } else {
      menu[/*LANG*/"Session"] = {
        value: field.session, min: 0, max: SESSIONS.length - 1,
        format: function(v) { return SESSIONS[v]; },
        onchange: function(v) { field.session = v; }
      };
      menu[/*LANG*/"Minutes"] = {
        value: field.minutes, min: 5, max: 30, step: 5,
        onchange: function(v) { field.minutes = v; }
      };
      menu[/*LANG*/"Severity"] = {
        value: field.severity, min: 1, max: 5,
        onchange: function(v) { field.severity = v; }
      };
      menu[/*LANG*/"Attempts"] = {
        value: field.attempts, min: 1, max: 10,
        onchange: function(v) { field.attempts = v; }
      };
      menu[/*LANG*/"Start"] = startRecording;
    }
    menu[/*LANG*/"Recordings (" + recordings().length + ")"] = showRecordings;
    E.showMenu(menu);
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
    menu[/*LANG*/"Field test"] = showField;
    menu[/*LANG*/"Detection"] = { value: GS ? (GS.rec ? /*LANG*/"recording" : /*LANG*/"on") : /*LANG*/"off" };
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
