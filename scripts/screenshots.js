#!/usr/bin/env node
// Renders app screens in the real Bangle.js 2 emulator firmware and saves them
// as apps/<appid>/screenshot-<name>.png (the BangleApps loader convention).
//
// Each app opts in with apps/<appid>/tests/screenshots.js exporting
//   [{ name: "status", code: "<Espruino code to run>", wait: 1500 }, ...]
//
// Usage: npm run screenshots [-- <appid> ...]

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { startEmulator, sendCode } = require("../tests/helpers/emulator");
const { prelude } = require("../tests/helpers/emulator-mocks");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://www.espruino.com";

function appsToRender(filter) {
  return fs.readdirSync(path.join(ROOT, "apps"))
    .filter((id) => !filter.length || filter.includes(id))
    .filter((id) => fs.existsSync(path.join(ROOT, "apps", id, "tests", "screenshots.js")));
}

// The emulator echoes serial output one character at a time as console
// messages; reassemble it so firmware errors can be reported.
function captureSerial(page) {
  let out = "";
  page.on("console", (msg) => {
    const m = msg.text().match(/"data": "((?:[^"\\]|\\.)*)"/);
    if (m) out += JSON.parse("\"" + m[1] + "\"");
  });
  return () => out;
}

async function renderScene(browser, appId, scene) {
  const page = await browser.newPage({ baseURL: BASE_URL });
  const serial = captureSerial(page);
  const canvas = await startEmulator(page);
  await sendCode(page, prelude());
  await sendCode(page, scene.code);
  await page.waitForTimeout(scene.wait || 1500);
  const file = path.join(ROOT, "apps", appId, "screenshot-" + scene.name + ".png");
  // Read the canvas pixels directly so the PNG is the watch's native
  // 176x176, not the page's scaled-up rendering.
  const dataUrl = await canvas.evaluate((c) => c.toDataURL("image/png"));
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  const errors = serial().split("\n").filter((l) => !l.startsWith(">") && /Uncaught|^Error|WARNING/.test(l));
  await page.close();
  return { file, errors };
}

async function main() {
  const filter = process.argv.slice(2);
  const browser = await chromium.launch();
  let failed = false;
  try {
    for (const appId of appsToRender(filter)) {
      const scenes = require(path.join(ROOT, "apps", appId, "tests", "screenshots.js"));
      for (const scene of scenes) {
        const { file, errors } = await renderScene(browser, appId, scene);
        console.log((errors.length ? "WARN " : "ok   ") + path.relative(ROOT, file));
        for (const e of errors) console.log("     " + e);
        if (errors.length) failed = true;
      }
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exitCode = 1;
}

main();
