/**
 * Hermetic finance golden paths (existing e2e harness style).
 * Complements Playwright UI smoke under e2e/finance/.
 */
import { runFinanceGoldenPaths } from '@/lib/finance/e2e/golden-paths'

describe('finance e2e golden paths (hermetic)', () => {
  test('six golden paths pass with hard gates false', async () => {
    const report = await runFinanceGoldenPaths()
    expect(report.ok).toBe(true)
    expect(report.seedKey).toBe('pib-demo-proving-v1')
    expect(report.hardGates).toEqual({
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      noAutoPostBankRules: true,
    })
    expect(report.paths.map((p) => p.id)).toEqual([
      'hub-scope-deeplinks',
      'ar-invoice-allocate-credit',
      'bank-rules-suggest-accept',
      'payroll-approve-lock',
      'packaging-download',
      'tenant-isolation',
    ])
    for (const path of report.paths) {
      expect(path.ok).toBe(true)
      expect(path.hardGates.sarsSubmissionInitiated).toBe(false)
      expect(path.hardGates.externalPaymentInitiated).toBe(false)
    }

    const bank = report.paths.find((p) => p.id === 'bank-rules-suggest-accept')!
    expect(bank.hardGates.autoPosted).toBe(false)

    const pack = report.paths.find((p) => p.id === 'packaging-download')!
    expect((pack.evidence.fileCount as number) >= 1).toBe(true)
    expect((pack.evidence.provingPackCount as number) >= 11).toBe(true)

    const hub = report.paths.find((p) => p.id === 'hub-scope-deeplinks')!
    expect(hub.evidence.deepLinks).toEqual(
      expect.arrayContaining([
        '/portal/finance/documents',
        '/portal/finance/bank-rules',
        '/portal/finance/payroll',
        '/portal/finance/packaging',
      ]),
    )
  }, 120_000)
})
