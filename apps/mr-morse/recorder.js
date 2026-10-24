// Field-test recorder. While a session runs it writes everything the engine
// hears (taps, the 12.5 Hz accelerometer stream, lock changes, screen
// touches) and everything it decides to a StorageFile, so the session can be
// replayed through the same engine in node and the two compared
// (tests/recordings.test.js, FIELD-TESTS.md).
//
// Loaded by morse.boot.js at every app load while morse.rec.json exists, and
// by the app when a session starts (live = true). One line per event:
//   b,t,locked,fresh   engine (re)loaded; fresh = 0 when started from the app
//   a,t,x,y,z,diff     accelerometer, milli-g
//   t,t,dir,double     tap from the accelerometer's tap engine
//   l,t,locked         lock change
//   p,t                screen touch
//   e,t,kind[,arg]     engine decision: skip, reject, echo, done, cancel, mon, moff
//   s,t                session stopped
// t is ms since the session started. The app writes a "#{json}" header first.
(function(GS, rec, live) {
  var S = require("Storage");
  if (Date.now() >= rec.until) { S.erase("morse.rec.json"); return; }

  var file = S.open(rec.file, "a");
  var buf = "";
  var timer;

  function ms() { return Math.round(Date.now() - rec.start); }
  function mg(v) { return Math.round(v * 1000); }

  // Buffered: one flash write every couple of seconds, not 12 a second.
  function flush() {
    if (!buf) return;
    file.write(buf);
    buf = "";
  }

  function put(line) {
    buf += line + "\n";
    if (buf.length > 1000) flush();
  }

  function onAccel(a) { put("a," + ms() + "," + mg(a.x) + "," + mg(a.y) + "," + mg(a.z) + "," + mg(a.diff)); }
  function onTap(d) { put("t," + ms() + "," + d.dir + "," + (d.double ? 1 : 0)); }
  function onLock(on) { put("l," + ms() + "," + (on ? 1 : 0)); }
  function onTouch() { put("p," + ms()); }
  function onDrag(e) { if (e.b) put("p," + ms()); }

  function stop() {
    clearInterval(timer);
    Bangle.removeListener("accel", onAccel);
    Bangle.removeListener("tap", onTap);
    Bangle.removeListener("lock", onLock);
    Bangle.removeListener("touch", onTouch);
    Bangle.removeListener("drag", onDrag);
    put("s," + ms());
    flush();
    S.erase("morse.rec.json");
    GS.recording = false;
    GS.trace = null;
    GS.rec = null;
    Bangle.setOptions({ powerSave: true });
  }

  put("b," + ms() + "," + (Bangle.isLocked() ? 1 : 0) + "," + (live ? 0 : 1));
  GS.recording = true;
  GS.trace = function(kind, arg) {
    put("e," + ms() + "," + kind + (arg === undefined ? "" : "," + arg));
  };
  Bangle.setPollInterval(80);   // the whole stream, not just the engine's slices
  Bangle.on("accel", onAccel);
  Bangle.on("tap", onTap);
  Bangle.on("lock", onLock);
  Bangle.on("touch", onTouch);
  Bangle.on("drag", onDrag);
  E.on("kill", flush);          // an app load would drop the buffer
  timer = setInterval(function() {
    flush();
    if (Date.now() < rec.until) return;
    stop();
    Bangle.buzz(400).then(function() { setTimeout(function() { Bangle.buzz(400); }, 300); });
  }, 2000);

  GS.rec = { file: rec.file, label: rec.label, until: rec.until, stop: stop };
})
