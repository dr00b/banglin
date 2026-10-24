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

// Read the canvas's own pixels rather than screenshotting the element. The
// emulator page sizes the canvas with CSS (it has changed over time, and
// scales with the device), so an element screenshot is whatever size the page
// feels like; the pixels are always the watch's native 176x176.
async function canvasPng(canvas) {
  const dataUrl = await canvas.evaluate((c) => c.toDataURL("image/png"));
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// The emulator echoes serial output one character at a time as console
// messages; reassemble it so firmware output and errors can be read. Call
// before startEmulator; returns a function giving everything so far.
function captureSerial(page) {
  let out = "";
  page.on("console", (msg) => {
    const m = msg.text().match(/"data": "((?:[^"\\]|\\.)*)"/);
    if (m) out += JSON.parse("\"" + m[1] + "\"");
  });
  return () => out;
}

module.exports = { EMULATOR_URL, startEmulator, sendCode, canvasPng, captureSerial };
