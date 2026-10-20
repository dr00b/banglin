// Background tap engine. Registered at every app load, so it costs nothing
// until the accelerometer's own tap detector fires: a pair of taps plus one
// spaced tap arms it, and the taps after that are the severity. Exposed as
// global.MORSE so the app and widget can show its state.
(function() {
  var S = require("Storage");
  var settings = Object.assign({
    enabled: true,
    onlyWhenLocked: true,  // a tap while the UI is in use belongs to the UI
    lockDuringCount: true,
    tapSens: 0,            // 0: leave the accelerometer's tap threshold alone
    quietMs: 4000,         // counting ends this long after the last tap
    waitMaxMs: 1500,
    muteMs: 300,           // deaf after a buzz: the motor shakes the accelerometer
    cooldownMs: 3000,
    touchVetoMs: 250,
    pauseInSleep: false,   // logging at 3am is the point, so off by default
    sleepStart: 23 * 3600000,
    sleepEnd: 7 * 3600000
  }, S.readJSON("morse.json", 1) || {});
  if (!settings.enabled) return;

  var T = (function() {
    // Declared locally so the module's UMD wrapper takes the Espruino branch.
    var module, exports; // jshint ignore:line
    var code = S.read("morse.tapseq.js");
    if (!code) return null;
    eval(code);
    return global.morseTap;
  })();
  if (!T) return;

  var GS = global.MORSE = {
    settings: settings,
    state: "idle",     // mirrors the sequencer: idle/half/waiting/echo/counting
    count: 0,
    paused: false,     // set by the app when it wants the engine quiet
    dryRun: false,     // set by the app's Live test: report, don't log
    lastTap: null,     // {t, dir, double, skipped} for every tap, used or not
    taps: [],          // the last 16 of those, for the Live test's timeline
    last: null,        // {t, severity, dry} of the last completed count
    onUpdate: null     // app hook, called on any change
  };

  var seq = T.createSequencer({ quietMs: settings.quietMs, waitMaxMs: settings.waitMaxMs });
  var timer = null, muteUntil = 0, cooldownUntil = 0, lastTouch = 0, wasLocked = true;

  function notify(widget) {
    if (widget && global.WIDGETS && WIDGETS.morse) WIDGETS.morse.draw();
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

  // Screen taps are the touch controller's business. Stay out while the user
  // is driving the UI, and for a moment after a poke at the glass, which
  // shakes the watch enough to raise a tap of its own. The Live test is the
  // exception: the user is looking at an unlocked screen on purpose there, so
  // only the touch veto applies.
  function uiActive(now) {
    if (settings.onlyWhenLocked && !GS.dryRun && !Bangle.isLocked()) return true;
    return now - lastTouch < settings.touchVetoMs;
  }

  function mute(ms) {
    muteUntil = Math.max(muteUntil, Date.now() + ms);
  }

  // The 250 ms tick only runs while something is in progress.
  function syncTimer() {
    var busy = GS.state !== "idle";
    if (busy && !timer) timer = setInterval(function() { handle(seq.tick(Date.now())); }, 250);
    else if (!busy && timer) { clearInterval(timer); timer = null; }
  }

  function logEvent(severity) {
    var log = S.readJSON("morse.log.json", 1) || [];
    log.push({ t: Math.round(Date.now() / 1000), s: severity, src: "tap" });
    while (log.length > 500) log.shift();
    S.writeJSON("morse.log.json", log);
  }

  function buzzCount(n) {
    mute(300 + n * 320 + settings.muteMs);
    var i = 0;
    function next() {
      if (i++ >= n) return;
      Bangle.buzz(120).then(function() { setTimeout(next, 200); });
    }
    setTimeout(next, 300);
  }

  // The password played back: buzz-buzz, pause, buzz. Kept to ~0.6 s so the
  // go-ahead lands close to the user's own tapping rhythm.
  function echo() {
    mute(900);
    Bangle.buzz(80);
    setTimeout(function() { Bangle.buzz(80); }, 200);
    setTimeout(function() { Bangle.buzz(80); }, 520);
    setTimeout(startCounting, 600);
  }

  function startCounting() {
    mute(settings.muteMs);
    if (settings.lockDuringCount && !GS.dryRun) {
      wasLocked = Bangle.isLocked();
      Bangle.setLocked(true);  // the counting taps must not poke the live app
    }
    seq.armed(Date.now());
    GS.state = seq.state();
    GS.count = seq.count();
    syncTimer();
    notify(true);
  }

  function finish(severity) {
    GS.last = { t: Date.now(), severity: severity, dry: GS.dryRun };
    cooldownUntil = Date.now() + settings.cooldownMs;
    if (settings.lockDuringCount && !GS.dryRun && !wasLocked) Bangle.setLocked(false);
    if (severity > 0) {
      if (!GS.dryRun) logEvent(severity);
      buzzCount(severity);
      setTimeout(notify, 61000, true); // widget drops the result after a minute
    } else {
      mute(600);
      Bangle.buzz(300, 0.4); // armed but nothing counted: cancelled
    }
  }

  function handle(action) {
    GS.state = seq.state();
    GS.count = seq.count();
    if (action && action.type === "echo") echo();
    else if (action && action.type === "done") finish(action.severity);
    else if (action && action.type === "cancel") finish(0);
    syncTimer();
    notify(true);
  }

  Bangle.on("tap", function(d) {
    var now = Date.now();
    var skip = now < muteUntil || GS.paused || now < cooldownUntil || asleep() || uiActive(now);
    GS.lastTap = { t: now, dir: d && d.dir, double: !!(d && d.double), skipped: skip };
    GS.taps.push(GS.lastTap);
    while (GS.taps.length > 16) GS.taps.shift();
    if (skip) { notify(false); return; }
    handle(seq.tap(!!(d && d.double), now));
  });

  Bangle.on("touch", function() { lastTouch = Date.now(); });
  Bangle.on("drag", function(e) { if (e.b) lastTouch = Date.now(); });

  // The tap detector lives in the accelerometer, not in Espruino. Only poke
  // its registers when a threshold is configured: PC1 (bit 7 of CNTL1) has to
  // be cleared before config is writable, INC3 enables taps from all six
  // directions, 0x27 is the threshold, then PC1|TDTE restarts the engine. The
  // firmware rewrites CNTL1 when power-save changes, so re-apply periodically.
  function applyTapConfig() {
    try {
      var c = Bangle.accelRd(0x18) & ~0x80;
      Bangle.accelWr(0x18, c);
      Bangle.accelWr(0x1E, 0x3F);
      Bangle.accelWr(0x27, settings.tapSens);
      Bangle.accelWr(0x18, c | 0x84);
    } catch (e) {
      print("mr-morse: tap config failed", e);
    }
  }

  if (settings.tapSens) {
    applyTapConfig();
    setInterval(applyTapConfig, 600000);
  }
})();
