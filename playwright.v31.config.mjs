import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 30000, expect: { timeout: 8000 },
  retries: process.env.CI ? 1 : 0, workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : 'list',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'firefox-smoke', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-smoke', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit-smoke', use: { ...devices['iPhone 15'] } }
  ],
  webServer: { command: 'npm run start', url: 'http://127.0.0.1:3000/api/health', reuseExistingServer: !process.env.CI, timeout: 60000 }
});
