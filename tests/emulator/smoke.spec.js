const { test, expect } = require("@playwright/test");
const { startEmulator, sendCode, canvasPng } = require("../helpers/emulator");

test("emulator loads and renders watch display", async ({ page }) => {
  const canvas = await startEmulator(page);
  await page.waitForTimeout(2000);
  expect(await canvasPng(canvas)).toMatchSnapshot("watch-boot.png", {
    maxDiffPixelRatio: 0.05
  });
});

test("can execute JavaScript on emulator", async ({ page }) => {
  const canvas = await startEmulator(page);
  await sendCode(page, 'g.clear(1);g.setFont("6x8",3);g.drawString("HELLO",30,100);\n');
  await page.waitForTimeout(1000);
  expect(await canvasPng(canvas)).toMatchSnapshot("watch-hello.png", {
    maxDiffPixelRatio: 0.05
  });
});
