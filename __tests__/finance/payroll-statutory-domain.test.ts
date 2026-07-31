import {
  addStatutoryTotals,
  applyYtdOpening,
  buildExportContentDigest,
  chooseCertificateKind,
  differenceTotals,
  emptyStatutoryTotals,
  isFullyReconciled,
  taxMonthFromDate,
} from '@/lib/payroll/statutory'
import { zaDefaultTaxYearWindow } from '@/lib/jurisdictions/za/statutory'

describe('payroll statutory domain', () => {
  test('chooses IRP5 vs IT3(a) from PAYE and builds stable export digests', () => {
    expect(chooseCertificateKind(0)).toBe('IT3(a)')
    expect(chooseCertificateKind(1)).toBe('IRP5')
    expect(chooseCertificateKind(5, 10)).toBe('IT3(a)')
    expect(taxMonthFromDate('2026-03-25')).toBe('2026-03')
    const digestA = buildExportContentDigest({
      kind: 'emp201',
      taxYearId: 'ty1',
      recordIds: ['b', 'a'],
      recordDigests: ['d2', 'd1'],
    })
    const digestB = buildExportContentDigest({
      kind: 'emp201',
      taxYearId: 'ty1',
      recordIds: ['a', 'b'],
      recordDigests: ['d1', 'd2'],
    })
    expect(digestA).toBe(digestB)
    expect(digestA).toHaveLength(64)
  })

  test('aggregates openings into certificate totals and reconciles EMP501 differences', () => {
    const base = {
      ...emptyStatutoryTotals(),
      grossEarningsMinor: 1000,
      taxableEarningsMinor: 900,
      payeMinor: 100,
      uifEmployeeMinor: 10,
      uifEmployerMinor: 10,
      sdlEmployerMinor: 5,
      netPayMinor: 790,
      periodsIncluded: 1,
    }
    const withOpening = applyYtdOpening(base, {
      grossEarningsMinor: 500,
      taxableEarningsMinor: 400,
      payeMinor: 50,
      uifEmployeeMinor: 4,
      uifEmployerMinor: 4,
      sdlEmployerMinor: 2,
    })
    expect(withOpening.payeMinor).toBe(150)
    expect(withOpening.grossEarningsMinor).toBe(1500)

    const monthly = addStatutoryTotals(base, {
      ...emptyStatutoryTotals(),
      grossEarningsMinor: 500,
      taxableEarningsMinor: 400,
      payeMinor: 50,
      uifEmployeeMinor: 4,
      uifEmployerMinor: 4,
      sdlEmployerMinor: 2,
    })
    const difference = differenceTotals(monthly, withOpening)
    expect(difference.payeMinor).toBe(0)
    expect(difference.grossEarningsMinor).toBe(0)
    expect(isFullyReconciled({ ...difference, netPayMinor: 0 })).toBe(true)
    expect(difference.netPayMinor).toBe(0)
  })

  test('ZA tax year window maps 2025/26 to March-February', () => {
    expect(zaDefaultTaxYearWindow('2025/26')).toEqual({
      startDate: '2025-03-01',
      endDate: '2026-02-28',
    })
  })
})
