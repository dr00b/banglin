(function() {
  var S = require("Storage");
  var LOG_FILE = "gsym.log.json";
  var SAMPLES = "gsym.samples.csv";
  var LABELS = ["trigger", "noise"];
  var GS = global.GSYM; // engine from gsym.boot.js; undefined when detection is off

  var C = (function() {
    var module, exports; // jshint ignore:line
    eval(S.read("gsym.counter.js"));
    return global.gsymCounter;
  })();

  function loadLog() { return S.readJSON(LOG_FILE, 1) || []; }
  function saveLog(log) { S.writeJSON(LOG_FILE, log); }

  function pad2(n) { return ("0" + n).substr(-2); }
  function fmtStamp(t) {
    var d = new Date(t * 1000);
    return d.getDate() + "/" + (d.getMonth() + 1) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function sampleCounts() {
    var c = {}, f = S.open(SAMPLES, "r"), l;
    while ((l = f.readLine()) !== undefined) {
      var k = l.substr(0, l.indexOf(","));
      if (k) c[k] = (c[k] || 0) + 1;
    }
    return c;
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
    var N = 60, trace = new Int8Array(N), ti = 0;
    var det = C.createDetector({ enterDeg: GS.settings.enterDeg });
    var enter = GS.settings.enterDeg;

    function onAccel(a) {
      det.push(a.x, a.y, a.z);
      trace[ti] = E.clip(Math.round(det.offset()), -90, 90);
      ti = (ti + 1) % N;
    }

    function status() {
      if (GS.state === "counting") return /*LANG*/"Counting: " + GS.count;
      if (GS.last && GS.last.dry && Date.now() - GS.last.t < 8000) {
        return GS.last.severity ? /*LANG*/"Severity " + GS.last.severity : /*LANG*/"Cancelled";
      }
      return /*LANG*/"Twist x2 to start";
    }

    function detail() {
      var t = GS.lastTrigger, m = GS.lastMotion;
      if (t && t.src === "tf" && (!m || t.t >= m.t)) {
        return "TF: " + (t.name === undefined ? "?" : t.name) + " " + Math.round(t.conf * 100) + "%";
      }
      if (m) return /*LANG*/"Last: " + m.twists + " twist" + (m.twists === 1 ? "" : "s") + (m.rule ? " = trigger" : "");
      return GS.hasModel ? /*LANG*/"Detector: TF model" : /*LANG*/"Detector: rule";
    }

    function draw() {
      var R = header(status());
      g.setFont("6x8", 1).drawString(detail(), R.x + R.w / 2, R.y + 22);
      var top = R.y + 36, bot = R.y2 - 4, mid = (top + bot) / 2, half = (bot - top) / 2;
      var k = half / 90;
      // Dotted lines: zero and the +/- twist-angle threshold.
      for (var x = R.x; x < R.x2; x += 2) {
        g.setPixel(x, mid);
        if (x % 6 === 0) {
          g.setPixel(x, mid - enter * k);
          g.setPixel(x, mid + enter * k);
        }
      }
      g.setColor(GS.state === "counting" ? "#00f" : g.theme.fg);
      var dx = R.w / (N - 1), px, py;
      for (var i = 0; i < N; i++) {
        var y = mid - trace[(ti + i) % N] * k;
        if (i) g.drawLine(px, py, R.x + i * dx, y);
        px = R.x + i * dx; py = y;
      }
    }

    GS.dryRun = true;
    GS.onUpdate = draw;
    Bangle.on("accel", onAccel);
    var timer = setInterval(draw, 250);
    teardown = function() {
      Bangle.removeListener("accel", onAccel);
      clearInterval(timer);
      GS.dryRun = false;
      GS.onUpdate = null;
    };
    Bangle.setUI({ mode: "custom", back: showMain });
    draw();
  }

  // --- Record samples ---------------------------------------------------

  function record(label) {
    leave();
    var n = 0, f = S.open(SAMPLES, "a");

    function onGesture(xyz) {
      f.write(label + "," + (xyz.length / 3) + "," + xyz.join(",") + "\n");
      n++;
      Bangle.buzz(40);
      draw();
    }

    function draw() {
      var R = header(/*LANG*/"Record: " + label);
      g.setFont("Vector", 40).setFontAlign(0, 0).drawString(String(n), R.x + R.w / 2, R.y + R.h / 2 - 4);
      g.setFont("6x8", 1).setFontAlign(0, 1);
      g.drawString(/*LANG*/"Rest still between reps.", R.x + R.w / 2, R.y2 - 12);
      g.drawString(/*LANG*/"Each rep buzzes once.", R.x + R.w / 2, R.y2 - 2);
    }

    if (GS) GS.paused = true;
    Bangle.on("gesture", onGesture);
    teardown = function() {
      Bangle.removeListener("gesture", onGesture);
      if (GS) GS.paused = false;
    };
    Bangle.setUI({ mode: "custom", back: showRecordMenu });
    draw();
  }

  function showRecordMenu() {
    leave();
    var counts = sampleCounts();
    var menu = { "": { title: /*LANG*/"Record" }, "< Back": showMain };
    LABELS.forEach(function(l) {
      menu[l + " (" + (counts[l] || 0) + ")"] = function() { record(l); };
    });
    menu[/*LANG*/"Clear samples"] = function() {
      E.showPrompt(/*LANG*/"Delete all samples?").then(function(ok) {
        if (ok) S.open(SAMPLES, "r").erase();
        showRecordMenu();
      });
    };
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
    var menu = { "": { title: /*LANG*/"Gesture Log" }, "< Back": function() { load(); } };
    menu[/*LANG*/"Live test"] = showLive;
    menu[/*LANG*/"Record samples"] = showRecordMenu;
    menu[/*LANG*/"Events (" + loadLog().length + ")"] = showLog;
    menu[/*LANG*/"Detector"] = { value: !GS ? /*LANG*/"off" : GS.hasModel ? "TF" : /*LANG*/"rule" };
    // Settings are read by the boot code, so reload the app to apply them.
    menu[/*LANG*/"Settings"] = function() {
      eval(S.read("gsym.settings.js"))(function() { load("gsym.app.js"); });
    };
    E.showMenu(menu);
  }

  Bangle.loadWidgets();
  Bangle.drawWidgets();
  showMain();
})();
