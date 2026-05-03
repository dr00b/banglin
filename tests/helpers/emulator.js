const { expect } = require("@playwright/test");

const EMULATOR_URL = "/ide/emu/emu_banglejs2.html";

// The emulator page (common.js) is designed to be opened by the EspruinoWebIDE,
// which sends an "init" postMessage to start the interpreter. In standalone use
// (Playwright), common.js throws at window.opener.emu, leaving hwPinValue
// unassigned and jsInit/jsIdle never called. This function bootstraps the
// emulator manually.
async function startEmulator(page) {
  await page.goto(EMULATOR_URL);
  const canvas = page.locator("canvas#gfxcanvas");
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(
    () => typeof Module !== "undefined" && !!Module.ccall,
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    if (!hwPinValue) hwPinValue = new Uint8Array(PIN_COUNT);
    jsInit();
    jsIdle();
  });
  await page.waitForTimeout(1000);
  return canvas;
}

async function sendCode(page, code) {
  // Push code in small chunks so the Espruino IO buffer never overflows.
  // jsIdle() is called between chunks to drain the buffer before adding more.
  const CHUNK = 64;
  for (let start = 0; start < code.length; start += CHUNK) {
    const chunk = code.slice(start, start + CHUNK);
    await page.evaluate((src) => {
      if (!hwPinValue) hwPinValue = new Uint8Array(PIN_COUNT);
      for (let i = 0; i < src.length; i++) {
        Module.ccall("jshPushIOCharEvent", "number", ["number", "number"],
          [21, src.charCodeAt(i)]);
      }
      jsIdle();
    }, chunk);
  }
}

module.exports = { EMULATOR_URL, startEmulator, sendCode };
