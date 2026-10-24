// Background tap engine. Registered at every app load, so it costs nothing
// until the accelerometer's own tap detector fires: a pair of taps plus one
// spaced tap arms it, and the taps after that are the severity. Once a pair
// of taps has gone in, the engine also listens to the accelerometer stream to
// check the wrist is still (patting a back or a swinging arm isn't).
// Exposed as global.MORSE so the app and widget can show its state.
(function() {
  var S = require("Storage");
  var settings = Object.assign({
    enabled: true,
    onlyWhenLocked: true,  // a tap while the UI is in use belongs to the UI
    lockDuringCount: true,
    tapSens: 0,            // 0: leave the accelerometer's tap threshold alone
    quietMs: 4000,         // counting ends this long after the last tap
    waitMaxMs: 1500,
    preQuietMs: 1000,      // a password has to start out of silence...
    postQuietMs: 600,      // ...and be followed by it
    stillMax: 0.1,         // median accel change (g) allowed while tapping; 0: off
    tapDir: "",            // only accept password taps from this direction; "": any
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
    state: "idle",     // mirrors the sequencer: idle/half/waiting/confirm/echo/counting
    count: 0,
    paused: false,     // set by the app when it wants the engine quiet
    dryRun: false,     // set by the app's Live test: report, don't log
    lastTap: null,     // {t, dir, double, skipped, why} for every tap, used or not
    taps: [],          // the last 16 of those, for the Live test's timeline
    last: null,        // {t, severity, dry} of the last completed count
    rejected: null,    // {reason, t} of the last password thrown away
    motion: null,      // wrist movement measured for the last password
    recording: false,  // a field-test recording is running: don't log
    onUpdate: null,    // app hook, called on any change
    trace: null        // recorder/test hook: trace(kind, arg) on every decision
  };

  // Any protocol constant can be overridden from morse.json, to tune it
  // against field recordings without a code change.
  var seqOpts = {};
  for (var k in T.DEFAULTS) if (settings[k] !== undefined) seqOpts[k] = settings[k];
  var seq = T.createSequencer(seqOpts);
  var timer = null, muteUntil = 0, cooldownUntil = 0, lastTouch = 0, wasLocked = true;
  var samples = null, split = -1, powerSave = true, drawn = null;

  function trace(kind, arg) {
    if (GS.trace) GS.trace(kind, arg);
  }

  // What the widget shows. It's only redrawn when this changes, not for every
  // tap of a pat on the back.
  function widgetKey() {
    var s = GS.state;
    if (s === "counting") return "c" + GS.count;
    return (s === "waiting" || s === "confirm" || s === "echo" ? "arming" : "idle") +
      (GS.last ? GS.last.t : "");
  }

  function notify(widget) {
    if (widget && global.WIDGETS && WIDGETS.morse && widgetKey() !== drawn) {
      drawn = widgetKey();
      WIDGETS.morse.draw();
    }
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

  // Wrist stillness. Tapping the watch with the other hand leaves the wrist
  // nearly still; patting with the watch hand or knocking it mid-swing moves
  // it a lot. The accelerometer stream is only listened to from the pair to
  // the decision to echo (~1.5 s), so a lone knock never turns it on, at
  // 12.5 Hz since power-save may have slowed polling right down. The median
  // of the per-sample change ignores the few samples a tap itself spikes.
  // The stretch while the password goes in and the silence after it are
  // judged separately: when patting stops, the last pats look like a password
  // and the still arm afterwards would otherwise outvote the moving one.
  // A wrist that is plainly moving gives up early, so running or patting
  // doesn't keep the stream on for the whole confirm window.
  function onAccel(a) {
    samples.push(a.diff);
    if (samples.length > 40) samples.shift();
    if (split < 0 && samples.length >= 6 && median(samples) > settings.stillMax) {
      GS.motion = median(samples);
      seq.reject("moving", Date.now());
      handle(null);
    }
  }

  function startMotion() {
    if (!settings.stillMax || samples) return;
    samples = [];
    split = -1;
    var o = Bangle.getOptions ? Bangle.getOptions() : {};
    powerSave = o.powerSave !== false;
    Bangle.setPollInterval(80);   // also turns power-save off
    Bangle.on("accel", onAccel);
    trace("mon");
  }

  function stopMotion() {
    if (!samples) return;
    Bangle.removeListener("accel", onAccel);
    samples = null;
    trace("moff");
    if (powerSave) Bangle.setOptions({ powerSave: true });
    if (settings.tapSens) applyTapConfig(); // power-save changes rewrite CNTL1
  }

  function median(a) {
    if (a.length < 3) return null;
    var s = a.slice().sort(function(x, y) { return x - y; });
    return s[s.length >> 1];
  }

  // Wrist movement: the worse of during and after the password, or null if
  // there were too few samples to tell.
  function motion() {
    if (!samples) return null;
    if (split < 0) return median(samples);
    var a = median(samples.slice(0, split)), b = median(samples.slice(split));
    return a === null ? b : b === null ? a : Math.max(a, b);
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
    trace(severity > 0 ? "done" : "cancel", severity || undefined);
    if (severity > 0) {
      if (!GS.dryRun && !GS.recording) logEvent(severity);
      buzzCount(severity);
      // The widget drops the result after a minute.
      setTimeout(function() { drawn = null; notify(true); }, 61000);
    } else {
      mute(600);
      Bangle.buzz(300, 0.4); // armed but nothing counted: cancelled
    }
  }

  function handle(action) {
    if (action && action.type === "echo" && settings.stillMax) {
      GS.motion = motion();
      if (GS.motion !== null && GS.motion > settings.stillMax) {
        seq.reject("moving", Date.now());
        action = null;
      }
    }
    var st = seq.state();
    if (st === "waiting" || st === "confirm") startMotion();
    else stopMotion();
    if (st === "confirm" && GS.state !== "confirm" && samples) split = samples.length;
    if (seq.rejected() !== GS.rejected) {
      GS.rejected = seq.rejected();
      trace("reject", GS.rejected.reason);
    }
    GS.state = st;
    GS.count = seq.count();
    if (action && action.type === "echo") { trace("echo"); echo(); }
    else if (action && action.type === "done") finish(action.severity);
    else if (action && action.type === "cancel") finish(0);
    syncTimer();
    notify(true);
  }

  // Why a tap is sat out, or "" if the engine takes it.
  function skipReason(now) {
    if (now < muteUntil) return "buzz";
    if (GS.paused) return "paused";
    if (now < cooldownUntil) return "cooldown";
    if (asleep()) return "sleep";
    if (uiActive(now)) return "ui";
    return "";
  }

  Bangle.on("tap", function(d) {
    var now = Date.now(), why = skipReason(now);
    GS.lastTap = { t: now, dir: d && d.dir, double: !!(d && d.double), skipped: !!why, why: why };
    GS.taps.push(GS.lastTap);
    while (GS.taps.length > 16) GS.taps.shift();
    if (why) {
      trace("skip", why);
      // Real taps the engine sat out still mean the wrist is busy, unlike
      // the motor's own buzz.
      if (why !== "buzz") seq.heard(now);
      notify(false);
      return;
    }
    handle(seq.tap(!!(d && d.double), now, d && d.dir));
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

  // A field-test recording survives app loads: the marker file says one is
  // running, and the recorder (only loaded then) picks it back up.
  var rec = S.readJSON("morse.rec.json", 1);
  if (rec) {
    var recorder = S.read("morse.rec.js");
    if (recorder) eval(recorder)(GS, rec);
  }
})();
