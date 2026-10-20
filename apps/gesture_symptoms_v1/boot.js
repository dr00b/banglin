// Background gesture engine. Runs at every app load, so it stays idle until
// the firmware reports a gesture; the accelerometer stream is only read for
// the few seconds of counting after a trigger. Exposed as global.GSYM1 so the
// app and widget can show its state.
(function() {
  var S = require("Storage");
  var settings = Object.assign({
    enabled: true,
    detector: "auto",     // "auto": TF model if installed, else rule; "rule": never TF
    tfThreshold: 0.8,
    enterDeg: 35,
    quietMs: 1500,
    highAccuracy: false,
    pauseInSleep: true,
    sleepStart: 23 * 3600000,
    sleepEnd: 7 * 3600000
  }, S.readJSON("gsym1.json", 1) || {});
  if (!settings.enabled) return;

  var C = (function() {
    // Declared locally so the module's UMD wrapper takes the Espruino branch.
    var module, exports; // jshint ignore:line
    var code = S.read("gsym1.counter.js");
    if (!code) return null;
    eval(code);
    return global.gsymCounter;
  })();
  if (!C) return;

  var hasTF = false;
  try { require("tensorflow"); hasTF = true; } catch (e) {}

  var countOpts = { enterDeg: settings.enterDeg, quietMs: settings.quietMs };
  var GS = global.GSYM1 = {
    settings: settings,
    state: "idle",       // "idle" | "counting"
    count: 0,
    paused: false,       // set by the app while recording samples
    dryRun: false,       // set by the app's Live test: report, don't log
    hasModel: settings.detector !== "rule" && hasTF && S.list(/^\.tfmodel$/).length > 0,
    lastMotion: null,    // {t, twists, dir, rule} for every gesture
    lastTrigger: null,   // {t, src, name, conf}
    last: null,          // {t, severity, dry} of the last completed count
    onUpdate: null       // app hook, called on any change
  };

  var lastDir = 0, cooldownUntil = 0, counter, counterTimer, counterSrc;

  function notify(widget) {
    if (widget && global.WIDGETS && WIDGETS.gsym1) WIDGETS.gsym1.draw();
    if (GS.onUpdate) GS.onUpdate();
  }

  function msOfDay() {
    var d = new Date();
    return d.getHours() * 3600000 + d.getMinutes() * 60000 + d.getSeconds() * 1000;
  }

  function asleep() {
    if (!settings.pauseInSleep) return false;
    var a = settings.sleepStart, b = settings.sleepEnd, t = msOfDay();
    return a < b ? (t >= a && t < b) : (t >= a || t < b);
  }

  function ready() {
    return !GS.paused && GS.state === "idle" && Date.now() >= cooldownUntil && !asleep();
  }

  function buzzCount(n) {
    var i = 0;
    function next() {
      if (i++ >= n) return;
      Bangle.buzz(120).then(function() { setTimeout(next, 200); });
    }
    setTimeout(next, 300);
  }

  function logEvent(severity, src) {
    var log = S.readJSON("gsym1.log.json", 1) || [];
    log.push({ t: Math.round(Date.now() / 1000), s: severity, src: src });
    while (log.length > 500) log.shift();
    S.writeJSON("gsym1.log.json", log);
  }

  function onAccel(a) { check(counter.push(a.x, a.y, a.z, Date.now())); }

  function check(r) {
    if (r.severity !== GS.count) { GS.count = r.severity; notify(true); }
    if (r.done) finish(r.severity);
  }

  function finish(severity) {
    Bangle.removeListener("accel", onAccel);
    clearInterval(counterTimer);
    GS.state = "idle";
    cooldownUntil = Date.now() + 2000;
    GS.last = { t: Date.now(), severity: severity, dry: GS.dryRun };
    if (severity > 0) {
      if (!GS.dryRun) logEvent(severity, counterSrc);
      buzzCount(severity);
      setTimeout(notify, 61000, true); // widget drops the result after a minute
    } else {
      Bangle.buzz(300, 0.4); // nothing counted: cancelled
    }
    notify(true);
  }

  function startCounting(dir, src, conf) {
    GS.state = "counting";
    GS.count = 0;
    GS.lastTrigger = { t: Date.now(), src: src, name: "trigger", conf: conf };
    counterSrc = src;
    counter = C.createCounter(dir, Date.now(), countOpts);
    Bangle.buzz(60);
    Bangle.on("accel", onAccel);
    counterTimer = setInterval(function() { check(counter.tick(Date.now())); }, 250);
    notify(true);
  }

  // 'gesture' is queued before 'aiGesture' for the same motion, so lastDir is
  // already set when the model's verdict arrives.
  Bangle.on("gesture", function(xyz) {
    if (!ready()) return;
    var r = C.classifyTrigger(xyz, countOpts);
    lastDir = r.dir;
    GS.lastMotion = { t: Date.now(), twists: r.twists.length, dir: r.dir, rule: r.isTrigger };
    if (!GS.hasModel && r.isTrigger) startCounting(r.dir, "rule", 1);
    else notify(false);
  });

  if (GS.hasModel) Bangle.on("aiGesture", function(name, weights) {
    if (!ready()) return;
    var conf = C.confidence(weights);
    GS.lastTrigger = { t: Date.now(), src: "tf", name: name, conf: conf };
    if (name === "trigger" && conf >= settings.tfThreshold && lastDir) startCounting(lastDir, "tf", conf);
    else notify(false);
  });

  // High accuracy keeps the accelerometer at 12.5 Hz while awake so the first
  // twist after stillness isn't missed (~+0.15 mA).
  if (settings.highAccuracy) {
    var applyPower = function() {
      if (asleep()) {
        Bangle.setOptions({ powerSave: true });
      } else {
        Bangle.setOptions({ powerSave: false });
        Bangle.setPollInterval(80);
      }
    };
    applyPower();
    setInterval(applyPower, 600000);
  }
})();
