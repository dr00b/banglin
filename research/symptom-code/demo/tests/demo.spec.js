const { test, expect } = require("@playwright/test");
const path = require("path");

const PAGE = "file://" + path.resolve(__dirname, "../index.html");

async function taps(page, n, gapMs) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Space");
    if (i < n - 1) await page.waitForTimeout(gapMs);
  }
}

test("logs a symptom typed as password, symptom, severity", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator("#log-list")).toContainText("Example");

  await page.keyboard.press("Space");
  await page.waitForTimeout(180);
  await page.keyboard.press("Space");
  await page.waitForTimeout(700);
  await page.keyboard.press("Space");
  await expect(page.locator("#log-status")).toContainText("Go ahead", { timeout: 3000 });

  await page.waitForTimeout(1300);     // let the buzz-back finish
  await taps(page, 2, 300);            // Bloating
  await expect(page.locator("#log-status")).toContainText("severity", { timeout: 3000 });
  await taps(page, 2, 300);            // moderate
  await expect(page.locator("#log-status")).toContainText("Logged: Bloating, moderate", { timeout: 5000 });

  const first = page.locator("#log-list li").first();
  await expect(first).toContainText("Bloating");
  await expect(first).not.toContainText("Example");
});

test("practice grades a tapped code", async ({ page }) => {
  await page.goto(PAGE + "#practice");
  const prompt = await page.locator("#pr-prompt").innerText();
  const names = ["Cramps", "Bloating", "Fatigue"];
  const symptom = names.findIndex(n => prompt.startsWith(n)) + 1;
  const severity = ["mild", "moderate", "severe"].findIndex(s => prompt.includes(s)) + 1;
  expect(symptom).toBeGreaterThan(0);

  await taps(page, symptom, 300);
  await page.waitForTimeout(1300);
  await taps(page, severity, 300);
  await expect(page.locator("#pr-status")).toContainText("Right", { timeout: 5000 });
  await expect(page.locator("#pr-session")).toContainText("1 of 10");
});

test("wallet card follows setup", async ({ page }) => {
  await page.goto(PAGE + "#setup");
  await page.selectOption("#preset", "ra");
  await page.click("#tab-card");
  const card = page.locator("#card-out .wallet").first();
  await expect(card).toContainText("Joint pain");
  await expect(card).toContainText("Stiffness");
  await card.screenshot({ path: "test-results/tap3-card.png" });
});
