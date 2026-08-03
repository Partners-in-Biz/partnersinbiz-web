import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const liveBase = process.env.FINANCE_E2E_BASE_URL

/**
 * Finance golden-path Playwright config.
 * Default: hermetic (static UI shell + domain report from globalSetup).
 * Optional live: FINANCE_E2E_BASE_URL=https://… npm run test:finance:e2e:live
 */
export default defineConfig({
  testDir: path.join(__dirname, 'e2e/finance'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/finance-e2e-playwright-report.json' }]],
  timeout: 60_000,
  globalSetup: path.join(__dirname, 'e2e/finance/global-setup.ts'),
  use: {
    baseURL: liveBase || 'http://127.0.0.1:4177',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: liveBase
    ? undefined
    : {
        command: 'npx --yes serve e2e/finance/fixtures -l 4177 --no-port-switching',
        url: 'http://127.0.0.1:4177/finance-ui-shell.html',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: 'chromium-finance-golden',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: 'artifacts/finance-e2e-test-results',
})
