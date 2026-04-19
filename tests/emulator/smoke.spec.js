const { test, expect } = require("@playwright/test");

const EMULATOR_URL = "/ide/emu/emu_banglejs2.html";

test("emulator loads and renders watch display", async ({ page }) => {
  await page.goto(EMULATOR_URL);
  const canvas = page.locator("canvas#gfxcanvas");
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(3000);
  await expect(canvas).toHaveScreenshot("watch-boot.png", {
    maxDiffPixelRatio: 0.05
  });
});

test("can execute JavaScript on emulator", async ({ page }) => {
  await page.goto(EMULATOR_URL);
  const canvas = page.locator("canvas#gfxcanvas");
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    if (typeof Module !== "undefined" && Module.ccall) {
      var code = 'g.clear();g.setFont("6x8",3);g.drawString("HELLO",30,100);\n';
      for (var i = 0; i < code.length; i++) {
        Module.ccall("jshPushIOCharEvent", "number", ["number", "number"],
          [0xE0, code.charCodeAt(i)]);
      }
    }
  });
  await page.waitForTimeout(1000);

  await expect(canvas).toHaveScreenshot("watch-hello.png", {
    maxDiffPixelRatio: 0.05
  });
});
