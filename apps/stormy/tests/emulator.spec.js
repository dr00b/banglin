const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { startEmulator, sendCode } = require("../../../tests/helpers/emulator");

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, rel), "utf8");
}

test("stormy status screen renders with pressure trend", async ({ page }) => {
  const canvas = await startEmulator(page);

  const trendLib = read("../../../lib/pressure-trend.js");
  const app = read("../app.js");

  const synthLog = [];
  const now = Math.floor(Date.now() / 60000);
  for (let i = 0; i < 18; i++) {
    synthLog.push({
      t: now - (17 - i) * 10,
      p: 1015 - (i / 17) * 4,
      T: 18 + (i / 17) * 2,
      h: null, pr: null
    });
  }

  const bootstrap =
    'require("Storage").write("stormy.trend.js", ' + JSON.stringify(trendLib) + ');\n' +
    'require("Storage").writeJSON("stormy.json", { enabled: true, alertPending: true, usePhoneForecast: false });\n' +
    'require("Storage").writeJSON("stormy.log.json", ' + JSON.stringify(synthLog) + ');\n' +
    'g.clear();\n';

  await sendCode(page, bootstrap);
  await page.waitForTimeout(500);
  await sendCode(page, app + "\n");
  await page.waitForTimeout(1500);

  await expect(canvas).toHaveScreenshot("stormy-status.png", {
    maxDiffPixelRatio: 0.05
  });
});
