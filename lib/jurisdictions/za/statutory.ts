/**
 * ZA statutory-ready report mappings for IRP5/IT3(a), EMP201, EMP501.
 * Produces accountant-ready field maps only — no electronic SARS submission/payment.
 */
import type { CertificateKind, StatutoryMoneyTotals, TaxTableReference } from '@/lib/payroll/types'
import { ZA_JURISDICTION_CODE } from './tax'
import { ZA_PAYROLL_PACKAGE_V2026 } from './payroll'

export const ZA_STATUTORY_CERTIFICATE_CODES = {
  IRP5: 'IRP5',
  IT3A: 'IT3(a)',
} as const

/** SARS-style source code labels for export evidence (not a live eFiling payload). */
export const ZA_IRP5_SOURCE_CODES = {
  /** Gross remuneration / income */
  code3601_grossRemuneration: '3601',
  /** PAYE */
  code4102_paye: '4102',
  /** UIF employee */
  code4141_uifEmployee: '4141',
  /** SDL employer contribution context (employer return, mirrored on evidence) */
  code4116_sdl: '4116',
} as const

export function zaDefaultTaxYearWindow(taxYearLabel: string): { startDate: string; endDate: string } {
  // Labels like 2025/26 => 1 Mar 2025 – 28/29 Feb 2026
  const match = /^(\d{4})\/(\d{2})$/.exec(taxYearLabel)
  if (!match) {
    throw new Error(`Unsupported ZA tax year label: ${taxYearLabel}`)
  }
  const startYear = Number(match[1])
  const endYearShort = Number(match[2])
  const endYear = startYear - (startYear % 100) + endYearShort
  const endLeap = endYear % 4 === 0 && (endYear % 100 !== 0 || endYear % 400 === 0)
  return {
    startDate: `${startYear}-03-01`,
    endDate: `${endYear}-02-${endLeap ? '29' : '28'}`,
  }
}

export function zaMapCertificateEvidence(input: {
  certificateKind: CertificateKind
  employeeNumber: string
  displayName: string
  taxYearLabel: string
  totals: StatutoryMoneyTotals
  taxTableReferences: TaxTableReference[]
}): Record<string, unknown> {
  return {
    jurisdictionCode: ZA_JURISDICTION_CODE,
    form: input.certificateKind === 'IRP5' ? ZA_STATUTORY_CERTIFICATE_CODES.IRP5 : ZA_STATUTORY_CERTIFICATE_CODES.IT3A,
    taxYearLabel: input.taxYearLabel,
    employeeNumber: input.employeeNumber,
    employeeDisplayName: input.displayName,
    codes: {
      [ZA_IRP5_SOURCE_CODES.code3601_grossRemuneration]: input.totals.grossEarningsMinor,
      taxableEarningsMinor: input.totals.taxableEarningsMinor,
      [ZA_IRP5_SOURCE_CODES.code4102_paye]: input.totals.payeMinor,
      [ZA_IRP5_SOURCE_CODES.code4141_uifEmployee]: input.totals.uifEmployeeMinor,
      uifEmployerMinor: input.totals.uifEmployerMinor,
      [ZA_IRP5_SOURCE_CODES.code4116_sdl]: input.totals.sdlEmployerMinor,
      netPayMinor: input.totals.netPayMinor,
      periodsIncluded: input.totals.periodsIncluded,
    },
    taxTableReferences: input.taxTableReferences,
    packageBoundaryDefault: {
      packageId: ZA_PAYROLL_PACKAGE_V2026.packageId,
      sourceChecksum: ZA_PAYROLL_PACKAGE_V2026.sourceChecksum,
    },
    sarsSubmissionInitiated: false,
    electronicFilingPayload: null,
  }
}

export function zaMapEmp201Evidence(input: {
  taxYearLabel: string
  taxMonth: string
  totals: StatutoryMoneyTotals
  employeeCount: number
  taxTableReferences: TaxTableReference[]
}): Record<string, unknown> {
  return {
    jurisdictionCode: ZA_JURISDICTION_CODE,
    form: 'EMP201',
    taxYearLabel: input.taxYearLabel,
    taxMonth: input.taxMonth,
    employeeCount: input.employeeCount,
    liabilities: {
      payeMinor: input.totals.payeMinor,
      uifEmployeeMinor: input.totals.uifEmployeeMinor,
      uifEmployerMinor: input.totals.uifEmployerMinor,
      uifTotalMinor: input.totals.uifEmployeeMinor + input.totals.uifEmployerMinor,
      sdlEmployerMinor: input.totals.sdlEmployerMinor,
      grossEarningsMinor: input.totals.grossEarningsMinor,
      taxableEarningsMinor: input.totals.taxableEarningsMinor,
    },
    taxTableReferences: input.taxTableReferences,
    sarsSubmissionInitiated: false,
    paymentInitiated: false,
    electronicFilingPayload: null,
  }
}

export function zaMapEmp501Evidence(input: {
  taxYearLabel: string
  monthlyTotals: StatutoryMoneyTotals
  certificateTotals: StatutoryMoneyTotals
  difference: Record<string, number>
  reconciled: boolean
  taxTableReferences: TaxTableReference[]
}): Record<string, unknown> {
  return {
    jurisdictionCode: ZA_JURISDICTION_CODE,
    form: 'EMP501',
    taxYearLabel: input.taxYearLabel,
    monthlyEmployerReturnRollup: input.monthlyTotals,
    employeeCertificateRollup: input.certificateTotals,
    difference: input.difference,
    reconciled: input.reconciled,
    taxTableReferences: input.taxTableReferences,
    sarsSubmissionInitiated: false,
    paymentInitiated: false,
    electronicFilingPayload: null,
  }
}
