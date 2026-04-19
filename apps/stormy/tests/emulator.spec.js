const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const EMULATOR_URL = "/ide/emu/emu_banglejs2.html";

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, rel), "utf8");
}

async function typeCode(page, code) {
  await page.evaluate((src) => {
    for (let i = 0; i < src.length; i++) {
      Module.ccall("jshPushIOCharEvent", "number", ["number", "number"],
        [0xE0, src.charCodeAt(i)]);
    }
  }, code);
}

test("stormy status screen renders with pressure trend", async ({ page }) => {
  await page.goto(EMULATOR_URL);
  const canvas = page.locator("canvas#gfxcanvas");
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(3000);

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

  await typeCode(page, bootstrap);
  await page.waitForTimeout(500);
  await typeCode(page, app + "\n");
  await page.waitForTimeout(1500);

  await expect(canvas).toHaveScreenshot("stormy-status.png", {
    maxDiffPixelRatio: 0.05
  });
});
