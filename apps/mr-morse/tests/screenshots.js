// Scenes rendered by scripts/screenshots.js into apps/mr-morse/screenshot-*.png.
const fs = require("node:fs");
const path = require("node:path");
const { storageWrite, storageWriteJSON, FAKE_CLOCK } = require("../../../tests/helpers/emulator-mocks");

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, rel), "utf8");
}

const now = Math.round(Date.now() / 1000);
const events = [
  { t: now - 86400 * 2 + 3600, s: 2, src: "tap" },
  { t: now - 86400 - 5400, s: 4, src: "tap" },
  { t: now - 7200, s: 3, src: "tap" },
  { t: now - 600, s: 1, src: "tap" }
];

// Install files and start the engine the way the watch does at boot. The
// emulator's screen is unlocked and has no one to lock it, so the UI guards
// are off for the captures.
function seed(settings) {
  return storageWrite("morse.tapseq.js", read("../../../lib/morse-protocol.js")) +
    storageWrite("morse.settings.js", read("../settings.js")) +
    storageWriteJSON("morse.json", Object.assign({
      onlyWhenLocked: false, lockDuringCount: false
    }, settings)) +
    storageWriteJSON("morse.log.json", events) +
    read("../boot.js") + "\n";
}

const app = read("../app.js") + "\n";

// Taps at real millisecond offsets, so the engine's own timers see the gaps.
function taps(list) {
  return list.map(function(t) {
    return "setTimeout(function(){Bangle.emit(\"tap\",{dir:\"left\",double:" +
      (t[1] ? "true" : "false") + "});}," + t[0] + ");";
  }).join("") + "\n";
}

module.exports = [
  {
    name: "main",
    code: seed({}) + app
  },
  {
    name: "live",
    // Long count timeout so the capture lands mid-count: the password at the
    // user's own rhythm, then two severity taps.
    code: seed({ quietMs: 20000 }) + app + "__pick(\"Live test\");\n" +
      taps([[0, false], [230, false], [930, false], [2100, false], [2400, false]]),
    wait: 3200
  },
  {
    name: "events",
    code: seed({}) + app + "__pick(\"Events (4)\");\n"
  },
  {
    // Shown with the real defaults, not the emulator's relaxed UI guards.
    name: "settings",
    code: seed({ onlyWhenLocked: true, lockDuringCount: true }) + app + "__pick(\"Settings\");\n"
  },
  {
    name: "widget",
    code: seed({}) + FAKE_CLOCK +
      "MORSE.last={t:Date.now(),severity:3,dry:false};\n" +
      "global.WIDGETS={};\n" + read("../widget.js") + "\n" +
      "WIDGETS.morse.x=150;WIDGETS.morse.y=0;WIDGETS.morse.draw();\n"
  }
];
