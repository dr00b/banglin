const { test, expect } = require("@playwright/test");
const { startEmulator, sendCode } = require("../helpers/emulator");

test("emulator loads and renders watch display", async ({ page }) => {
  const canvas = await startEmulator(page);
  await page.waitForTimeout(2000);
  await expect(canvas).toHaveScreenshot("watch-boot.png", {
    maxDiffPixelRatio: 0.05
  });
});

test("can execute JavaScript on emulator", async ({ page }) => {
  const canvas = await startEmulator(page);
  await sendCode(page, 'g.clear(1);g.setFont("6x8",3);g.drawString("HELLO",30,100);\n');
  await page.waitForTimeout(1000);
  await expect(canvas).toHaveScreenshot("watch-hello.png", {
    maxDiffPixelRatio: 0.05
  });
});
