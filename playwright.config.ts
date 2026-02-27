import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html'], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4318',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:4318',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  testMatch: '**/*.spec.ts',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
