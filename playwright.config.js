const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  testMatch: ["tests/emulator/**/*.spec.js", "apps/**/tests/*.spec.js", "research/**/tests/*.spec.js"],
  outputDir: "./test-results",
  use: {
    baseURL: "https://www.espruino.com",
    screenshot: "on",
    video: "retain-on-failure"
  }
});
