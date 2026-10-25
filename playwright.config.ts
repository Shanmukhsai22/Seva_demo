import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',timeout:45000,workers:1,
  use:{baseURL:process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'},trace:'retain-on-failure'},
  reporter:'list',outputDir:'test-results',
});
