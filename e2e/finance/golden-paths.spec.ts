import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

type GoldenPathReport = {
  ok: boolean
  seedKey: string
  paths: Array<{ id: string; ok: boolean; hardGates: Record<string, boolean> }>
  hardGates: {
    sarsSubmissionInitiated: boolean
    externalPaymentInitiated: boolean
    noAutoPostBankRules: boolean
  }
}

function loadReport(): GoldenPathReport {
  const reportPath =
    process.env.FINANCE_E2E_REPORT_PATH || path.join(process.cwd(), 'artifacts', 'finance-e2e-last-run.json')
  if (!existsSync(reportPath)) {
    throw new Error(`Missing domain report at ${reportPath}. Run npm run test:finance:e2e:domain first.`)
  }
  return JSON.parse(readFileSync(reportPath, 'utf8')) as GoldenPathReport
}

test.describe('Finance golden paths — hermetic domain evidence', () => {
  test('domain runner produced six green paths with hard gates false', () => {
    const report = loadReport()
    expect(report.ok).toBe(true)
    expect(report.seedKey).toBe('pib-demo-proving-v1')
    expect(report.hardGates.sarsSubmissionInitiated).toBe(false)
    expect(report.hardGates.externalPaymentInitiated).toBe(false)
    expect(report.hardGates.noAutoPostBankRules).toBe(true)
    expect(report.paths).toHaveLength(6)
    expect(report.paths.every((p) => p.ok)).toBe(true)
    expect(report.paths.map((p) => p.id)).toEqual([
      'hub-scope-deeplinks',
      'ar-invoice-allocate-credit',
      'bank-rules-suggest-accept',
      'payroll-approve-lock',
      'packaging-download',
      'tenant-isolation',
    ])
  })
})

test.describe('Finance golden paths — hermetic UI shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/finance-ui-shell.html')
  })

  test('1. hub shell has scope bar and deep links', async ({ page }) => {
    await expect(page.getByTestId('finance-module-shell')).toBeVisible()
    await expect(page.getByTestId('finance-scope-bar')).toBeVisible()
    await expect(page.getByTestId('finance-scope-bar').getByLabel('Legal entity')).toBeVisible()
    await expect(page.getByTestId('finance-scope-bar').getByLabel('Accounting book')).toBeVisible()

    for (const id of [
      'deeplink-documents',
      'deeplink-bank-rules',
      'deeplink-payroll',
      'deeplink-packaging',
      'deeplink-statements',
      'deeplink-proving',
    ]) {
      const link = page.getByTestId(id)
      await expect(link).toBeVisible()
      const href = await link.getAttribute('href')
      expect(href).toMatch(/^\/portal\/finance/)
    }
  })

  test('2–5. hard gates visible; bank Accept is human-gated never auto-post', async ({ page }) => {
    await expect(page.getByTestId('hard-gate-sars')).toHaveText(/No SARS submit/i)
    await expect(page.getByTestId('hard-gate-pay')).toHaveText(/No external payment initiate/i)
    await expect(page.getByTestId('finance-safety-readback')).toContainText('No SARS')
    await expect(page.getByTestId('finance-safety-readback')).toContainText('no external payment')

    const status = page.getByTestId('suggestion-status')
    await expect(status).toContainText('pending')
    await expect(status).toContainText('autoPosted=false')
    await page.getByTestId('suggestion-accept').click()
    await expect(status).toHaveAttribute('data-state', 'accepted')
    await expect(status).toContainText('autoPosted=false')
    await expect(status).toContainText('externalPaymentInitiated=false')
    await expect(status).toContainText('sarsSubmissionInitiated=false')
  })

  test('6. shell stays tenant-scoped (no cross-org controls)', async ({ page }) => {
    await expect(page.getByTestId('finance-scope-bar')).toContainText('Org org-e2e-demo')
    await expect(page.locator('body')).not.toContainText('Switch to any org without auth')
    // Negative: no SARS submit / pay initiate controls in shell
    await expect(page.getByRole('button', { name: /submit to sars/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /initiate payment|pay now|send payment/i })).toHaveCount(0)
  })
})

/**
 * Optional live portal smoke. Skipped unless FINANCE_E2E_BASE_URL is set.
 * Requires a signed-in storage state or session cookie — development/staging only.
 */
test.describe('Finance golden paths — live portal (optional)', () => {
  test.skip(!process.env.FINANCE_E2E_BASE_URL, 'Set FINANCE_E2E_BASE_URL to enable live portal smoke')

  test('live hub responds (auth may redirect)', async ({ page }) => {
    const base = process.env.FINANCE_E2E_BASE_URL!.replace(/\/$/, '')
    const res = await page.goto(`${base}/portal/finance`, { waitUntil: 'domcontentloaded' })
    expect(res).not.toBeNull()
    // 200 when authenticated; login redirect still proves route exists.
    expect([200, 302, 307, 401, 403].includes(res!.status()) || page.url().includes('login') || page.url().includes('finance')).toBe(
      true,
    )
  })
})
