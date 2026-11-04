const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testMatch: ['**/annotator.spec.js', '**/annotator.sync.spec.js', '**/annotator.mobile.spec.js'],
  timeout: 20_000,
  retries: 0,
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
  },
});
