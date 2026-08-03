/**
 * South African bank batch file templates for payment-instruction download packs.
 *
 * EXPORT / DOWNLOAD ONLY.
 * - Does not initiate payments
 * - Does not open bank sessions
 * - Does not auto-upload to banks
 * Operator downloads the file and uploads manually in their banking channel.
 *
 * Formats are template-style snapshots of common ACB / NetCash batch columns used
 * by SA operators — not a certified bank gateway integration.
 */

import { createHash } from 'crypto'
import type { PackagingFileArtifact } from './types'

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export type SaBankPaymentRow = {
  beneficiaryName: string
  bankName?: string
  accountNumber: string
  branchCode: string
  /** 1 = current/cheque, 2 = savings (SA convention). Default 1. */
  accountType?: string | number
  amountMinor: number
  currency?: string
  reference: string
  sourceDocumentId?: string
  employeeId?: string
  employeeName?: string
  netPayMinor?: number
  payRunId?: string
  /** YYYY-MM-DD preferred; defaults applied by caller when missing. */
  actionDate?: string
  /** Optional operator-side account reference / own reference. */
  accountReference?: string
}

export const SA_BANK_OPERATOR_NOTICE =
  'DOWNLOAD ONLY. Operator must download this file and upload it manually in the banking channel (internet banking / NetCash / ACB batch). Partners in Biz never initiates payments, opens bank sessions, or auto-uploads to banks.'

function textFile(name: string, contentType: string, content: string): PackagingFileArtifact {
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  return {
    name,
    contentType,
    encoding: 'utf8',
    content: normalized,
    sha256: sha256Hex(normalized),
    byteLength: Buffer.byteLength(normalized, 'utf8'),
  }
}

export function buildTxtFile(name: string, content: string): PackagingFileArtifact {
  return textFile(name, 'text/plain; charset=utf-8', content)
}

function asText(value: unknown, fallback = ''): string {
  if (value == null) return fallback
  return String(value).trim()
}

function digitsOnly(value: unknown): string {
  return asText(value).replace(/\D/g, '')
}

function accountTypeCode(value: unknown): string {
  const raw = asText(value, '1')
  if (raw === '2' || /^sav/i.test(raw)) return '2'
  if (raw === '3' || /^trans/i.test(raw)) return '3'
  return '1'
}

function amountMinorOf(row: Record<string, unknown>, preferNetPay = false): number {
  if (preferNetPay && row.netPayMinor != null && Number.isFinite(Number(row.netPayMinor))) {
    return Math.trunc(Number(row.netPayMinor))
  }
  if (row.amountMinor != null && Number.isFinite(Number(row.amountMinor))) {
    return Math.trunc(Number(row.amountMinor))
  }
  if (row.netPayMinor != null && Number.isFinite(Number(row.netPayMinor))) {
    return Math.trunc(Number(row.netPayMinor))
  }
  return 0
}

/** Rand amount with 2 decimal places from minor units (no currency symbol). */
export function minorToDecimalString(amountMinor: number): string {
  const sign = amountMinor < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(amountMinor))
  const whole = Math.floor(abs / 100)
  const cents = abs % 100
  return `${sign}${whole}.${String(cents).padStart(2, '0')}`
}

function actionDateOf(row: Record<string, unknown>, fallback: string): string {
  const d = asText(row.actionDate || row.paymentDate || row.valueDate)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  return fallback
}

function beneficiaryOf(row: Record<string, unknown>): string {
  return asText(row.beneficiaryName || row.employeeName || row.accountName || row.name, 'BENEFICIARY')
}

function referenceOf(row: Record<string, unknown>): string {
  return asText(row.reference || row.sourceDocumentId || row.payRunId || row.employeeId, 'REF')
}

function accountReferenceOf(row: Record<string, unknown>, index: number): string {
  const explicit = asText(row.accountReference || row.ownReference || row.employeeId || row.sourceDocumentId)
  if (explicit) return explicit.slice(0, 20)
  return `ROW${index + 1}`
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/**
 * ACB-style fixed-field CSV used by many SA bulk EFT upload screens.
 * Columns are stable for snapshot tests; not a live bank API.
 *
 * Record type 10 = detail credit line (template convention).
 */
export function buildAcbBatchCsv(
  rows: Array<Record<string, unknown>>,
  options: { preferNetPay?: boolean; actionDateFallback?: string; purpose?: 'ap' | 'payroll' } = {},
): PackagingFileArtifact {
  const actionFallback = options.actionDateFallback || '1970-01-01'
  const headers = [
    'RecordType',
    'BranchCode',
    'AccountNumber',
    'AccountType',
    'AmountCents',
    'Amount',
    'ActionDate',
    'BeneficiaryName',
    'StatementReference',
    'OwnReference',
    'BankName',
    'Currency',
  ]
  const lines = [headers.join(',')]
  rows.forEach((row, index) => {
    const amountMinor = amountMinorOf(row, options.preferNetPay)
    const cols = [
      '10',
      digitsOnly(row.branchCode).slice(0, 6),
      digitsOnly(row.accountNumber).slice(0, 16),
      accountTypeCode(row.accountType),
      String(amountMinor),
      minorToDecimalString(amountMinor),
      actionDateOf(row, actionFallback).replace(/-/g, ''),
      csvEscape(beneficiaryOf(row).slice(0, 30)),
      csvEscape(referenceOf(row).slice(0, 20)),
      csvEscape(accountReferenceOf(row, index).slice(0, 20)),
      csvEscape(asText(row.bankName).slice(0, 30)),
      csvEscape(asText(row.currency, 'ZAR').toUpperCase()),
    ]
    lines.push(cols.join(','))
  })
  const headerNotice = [
    `# ACB-style EFT batch template (${options.purpose || 'ap'})`,
    `# ${SA_BANK_OPERATOR_NOTICE}`,
    `# externalPaymentInitiated=false`,
  ].join('\n')
  return textFile('acb-batch.csv', 'text/csv; charset=utf-8', `${headerNotice}\n${lines.join('\n')}\n`)
}

/**
 * ACB-style plain text (pipe-delimited detail lines) for banks that expect .txt upload.
 */
export function buildAcbBatchTxt(
  rows: Array<Record<string, unknown>>,
  options: { preferNetPay?: boolean; actionDateFallback?: string; purpose?: 'ap' | 'payroll' } = {},
): PackagingFileArtifact {
  const actionFallback = options.actionDateFallback || '1970-01-01'
  const lines: string[] = [
    `H|ACB_TEMPLATE|${options.purpose || 'ap'}|DOWNLOAD_ONLY|externalPaymentInitiated=false`,
    `N|${SA_BANK_OPERATOR_NOTICE}`,
  ]
  rows.forEach((row, index) => {
    const amountMinor = amountMinorOf(row, options.preferNetPay)
    lines.push(
      [
        'D',
        '10',
        digitsOnly(row.branchCode).slice(0, 6),
        digitsOnly(row.accountNumber).slice(0, 16),
        accountTypeCode(row.accountType),
        String(amountMinor),
        actionDateOf(row, actionFallback).replace(/-/g, ''),
        beneficiaryOf(row).slice(0, 30).replace(/\|/g, ' '),
        referenceOf(row).slice(0, 20).replace(/\|/g, ' '),
        accountReferenceOf(row, index).slice(0, 20).replace(/\|/g, ' '),
        asText(row.currency, 'ZAR').toUpperCase(),
      ].join('|'),
    )
  })
  const total = rows.reduce((sum, row) => sum + amountMinorOf(row, options.preferNetPay), 0)
  lines.push(`T|${rows.length}|${total}|externalPaymentInitiated=false`)
  return buildTxtFile('acb-batch.txt', `${lines.join('\n')}\n`)
}

/**
 * NetCash-style CSV batch (common SA operator upload shape).
 * Amounts are decimal rand; Account type 1=Current 2=Savings.
 */
export function buildNetCashBatchCsv(
  rows: Array<Record<string, unknown>>,
  options: { preferNetPay?: boolean; purpose?: 'ap' | 'payroll' } = {},
): PackagingFileArtifact {
  const headers = [
    'Account reference',
    'Name',
    'Branch code',
    'Account number',
    'Account type',
    'Amount',
    'Extra 1',
    'Extra 2',
    'Email notification',
    'Mobile notification',
  ]
  const lines = [
    `# NetCash-style batch template (${options.purpose || 'ap'})`,
    `# ${SA_BANK_OPERATOR_NOTICE}`,
    `# externalPaymentInitiated=false`,
    headers.join(','),
  ]
  rows.forEach((row, index) => {
    const amountMinor = amountMinorOf(row, options.preferNetPay)
    const cols = [
      csvEscape(accountReferenceOf(row, index)),
      csvEscape(beneficiaryOf(row).slice(0, 50)),
      digitsOnly(row.branchCode).slice(0, 6),
      digitsOnly(row.accountNumber).slice(0, 16),
      accountTypeCode(row.accountType),
      minorToDecimalString(amountMinor),
      csvEscape(referenceOf(row).slice(0, 30)),
      csvEscape(asText(row.bankName || row.payRunId || row.sourceDocumentId).slice(0, 30)),
      '', // email notification — never auto-send
      '', // mobile notification — never auto-send
    ]
    lines.push(cols.join(','))
  })
  return textFile('netcash-batch.csv', 'text/csv; charset=utf-8', `${lines.join('\n')}\n`)
}

/**
 * NetCash-style plain text (comma-separated, no header comments beyond first line notice).
 */
export function buildNetCashBatchTxt(
  rows: Array<Record<string, unknown>>,
  options: { preferNetPay?: boolean; purpose?: 'ap' | 'payroll' } = {},
): PackagingFileArtifact {
  const lines: string[] = [
    `# NetCash-style TXT (${options.purpose || 'ap'}) | DOWNLOAD_ONLY | externalPaymentInitiated=false`,
    'Account reference,Name,Branch code,Account number,Account type,Amount,Extra 1',
  ]
  rows.forEach((row, index) => {
    const amountMinor = amountMinorOf(row, options.preferNetPay)
    lines.push(
      [
        csvEscape(accountReferenceOf(row, index)),
        csvEscape(beneficiaryOf(row).slice(0, 50)),
        digitsOnly(row.branchCode).slice(0, 6),
        digitsOnly(row.accountNumber).slice(0, 16),
        accountTypeCode(row.accountType),
        minorToDecimalString(amountMinor),
        csvEscape(referenceOf(row).slice(0, 30)),
      ].join(','),
    )
  })
  return buildTxtFile('netcash-batch.txt', `${lines.join('\n')}\n`)
}

export function buildSaBankFormatFiles(
  rows: Array<Record<string, unknown>>,
  options: {
    preferNetPay?: boolean
    actionDateFallback?: string
    purpose: 'ap' | 'payroll'
    /** When set, only emit that family; otherwise emit both ACB + NetCash. */
    family?: 'acb' | 'netcash' | 'all'
  },
): PackagingFileArtifact[] {
  const family = options.family || 'all'
  const files: PackagingFileArtifact[] = []
  if (family === 'acb' || family === 'all') {
    files.push(
      buildAcbBatchCsv(rows, options),
      buildAcbBatchTxt(rows, options),
    )
  }
  if (family === 'netcash' || family === 'all') {
    files.push(
      buildNetCashBatchCsv(rows, options),
      buildNetCashBatchTxt(rows, options),
    )
  }
  return files
}
