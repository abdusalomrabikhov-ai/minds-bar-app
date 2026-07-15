import { defineConfig, devices } from '@playwright/test';
import { getBaseUrl, getAuthFilePath } from './helpers/env-config';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['list']],
  use: {
    baseURL: getBaseUrl(),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Auth setup — runs before all suites
    {
      name: 'setup',
      testDir: './auth',
      testMatch: /auth\.setup\.ts/,
    },

    // Regression suite — full coverage
    {
      name: 'regression-chromium',
      testDir: './tests/regression',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: getAuthFilePath(),
      },
    },
    {
      name: 'regression-firefox',
      testDir: './tests/regression',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Firefox'],
        storageState: getAuthFilePath(),
      },
    },
    {
      name: 'regression-webkit',
      testDir: './tests/regression',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Safari'],
        storageState: getAuthFilePath(),
      },
    },

    // Handover suite — workflow verification
    {
      name: 'handover',
      testDir: './tests/handover',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: getAuthFilePath(),
      },
    },

    // Smoke suite — fast CI gate
    {
      name: 'smoke',
      testDir: './tests/smoke',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: getAuthFilePath(),
      },
    },

    // Mobile
    {
      name: 'mobile-chrome',
      testDir: './tests/regression',
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 5'],
        storageState: getAuthFilePath(),
      },
    },
    {
      name: 'mobile-safari',
      testDir: './tests/regression',
      dependencies: ['setup'],
      use: {
        ...devices['iPhone 13'],
        storageState: getAuthFilePath(),
      },
    },
  ],
});
