// Scenes rendered by scripts/screenshots.js into apps/stormy/screenshot-*.png.
const fs = require("node:fs");
const path = require("node:path");
const { storageWrite, storageWriteJSON, FAKE_CLOCK } = require("../../../tests/helpers/emulator-mocks");

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, rel), "utf8");
}

// 24 h of 10-minute samples: steady, then a 4.5 hPa fall over the last 3 h.
function stormLog() {
  const now = Math.floor(Date.now() / 60000);
  const log = [];
  for (let i = 0; i < 144; i++) {
    const hoursAgo = (143 - i) / 6;
    const fall = hoursAgo < 3 ? (3 - hoursAgo) * 1.5 : 0;
    log.push({
      t: now - (143 - i) * 10,
      p: Math.round((1016 + Math.sin(i / 20) * 0.6 - fall) * 10) / 10,
      T: Math.round((17 + Math.sin(i / 24) * 3) * 10) / 10,
      h: null, pr: null
    });
  }
  return log;
}

function seed(settings) {
  return storageWrite("stormy.trend.js", read("../../../lib/pressure-trend.js")) +
    storageWrite("stormy.settings.js", read("../settings.js")) +
    storageWriteJSON("stormy.json", Object.assign({ enabled: true }, settings)) +
    storageWriteJSON("stormy.log.json", stormLog());
}

const app = read("../app.js") + "\n";

module.exports = [
  {
    name: "status",
    code: seed({ alertPending: true }) + app
  },
  {
    name: "graph",
    code: seed({ alertPending: true }) + app + "__pick(\"View graph\");\n"
  },
  {
    name: "settings",
    code: seed({}) + app + "__pick(\"Settings\");\n"
  },
  {
    name: "settings-forecast",
    code: seed({ usePhoneForecast: true, lat: 51.5, lon: -0.1 }) + app +
      "__pick(\"Settings\");__scroll(200);\n"
  },
  {
    name: "widget",
    code: storageWriteJSON("stormy.json", { alertPending: true }) +
      FAKE_CLOCK +
      "global.WIDGETS={};\n" + read("../widget.js") + "\n" +
      "WIDGETS.stormy.x=2;WIDGETS.stormy.y=0;WIDGETS.stormy.draw.call(WIDGETS.stormy);\n"
  }
];
