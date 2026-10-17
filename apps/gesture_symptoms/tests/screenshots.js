// Scenes rendered by scripts/screenshots.js into apps/gesture_symptoms/screenshot-*.png.
const fs = require("node:fs");
const path = require("node:path");
const { storageWrite, storageWriteJSON, FAKE_CLOCK } = require("../../../tests/helpers/emulator-mocks");
const S = require("./synth.js");

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, rel), "utf8");
}

const now = Math.round(Date.now() / 1000);
const events = [
  { t: now - 86400 * 2 + 3600, s: 2, src: "rule" },
  { t: now - 86400 - 5400, s: 4, src: "rule" },
  { t: now - 7200, s: 3, src: "tf" },
  { t: now - 600, s: 1, src: "tf" }
];

// Install files and start the engine the way the watch does at boot.
function seed(settings) {
  return storageWrite("gsym.counter.js", read("../../../lib/gesture-counter.js")) +
    storageWrite("gsym.settings.js", read("../settings.js")) +
    storageWriteJSON("gsym.json", Object.assign({ pauseInSleep: false }, settings)) +
    storageWriteJSON("gsym.log.json", events) +
    read("../boot.js") + "\n";
}

const app = read("../app.js") + "\n";

function gestureCode(twists) {
  const buf = S.toGestureBuffer(S.toSamples(S.rollTrace(twists)));
  return "Bangle.emit(\"gesture\",new Int8Array(" + JSON.stringify(Array.from(buf)) + "));\n";
}

function accelCode(twists) {
  const samples = S.toSamples(S.rollTrace(twists, { leadMs: 300, tailMs: 240 }))
    .map((s) => [s.x, s.y, s.z].map((v) => Math.round(v * 100) / 100));
  return "(" + JSON.stringify(samples) + ").forEach(function(a){Bangle.emit(\"accel\",{x:a[0],y:a[1],z:a[2]});});\n";
}

module.exports = [
  {
    name: "main",
    code: seed({}) + app
  },
  {
    name: "live",
    // Long count timeout so the capture lands mid-count.
    code: seed({ quietMs: 8000 }) + app + "__pick(\"Live test\");\n" +
      gestureCode([1, 1]) + accelCode([-1, -1]) + "GSYM.onUpdate();\n",
    wait: 600
  },
  {
    name: "record",
    code: seed({}) + app + "__pick(\"Record samples\");__pick(\"trigger (0)\");\n" +
      gestureCode([1, 1]) + gestureCode([1, 1]) + gestureCode([1, 1])
  },
  {
    name: "events",
    code: seed({}) + app + "__pick(\"Events (4)\");\n"
  },
  {
    name: "settings",
    code: seed({}) + app + "__pick(\"Settings\");\n"
  },
  {
    name: "widget",
    code: seed({}) + FAKE_CLOCK +
      "GSYM.last={t:Date.now(),severity:3,dry:false};\n" +
      "global.WIDGETS={};\n" + read("../widget.js") + "\n" +
      "WIDGETS.gsym.x=150;WIDGETS.gsym.y=0;WIDGETS.gsym.draw();\n"
  }
];
