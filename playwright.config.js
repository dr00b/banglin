const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/emulator",
  outputDir: "./test-results",
  use: {
    baseURL: "https://www.espruino.com",
    screenshot: "on",
    video: "retain-on-failure"
  }
});
