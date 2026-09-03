'use client'

export type LegalEntity = {
  id: string
  code: string
  legalName: string
  status: string
  jurisdictionCode?: string
  functionalCurrency?: string
  defaultAccountingBasis?: 'cash' | 'accrual'
}

export type AccountingBook = {
  id: string
  code: string
  name: string
  status: string
  bookType: string
  accountingBasis: 'cash' | 'accrual'
  functionalCurrency: string
  cutoverAt?: string
}

export function newFinanceId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  }
  return `${prefix}_${Date.now().toString(36)}`
}

export function formatMinor(amount: number | undefined | null, currency = 'ZAR') {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return '-'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100)
}

export async function readFinanceJson(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message =
      typeof body?.error === 'string'
        ? body.error
        : typeof body?.message === 'string'
          ? body.message
          : `Request failed (${res.status})`
    throw new Error(message)
  }
  return body
}

export function todayISODate() {
  return new Date().toISOString().slice(0, 10)
}

export function requestIdentity(prefix: string) {
  const id = newFinanceId(prefix)
  return { requestId: id, idempotencyKey: id }
}

export function parseRandsToMinor(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return 0
  const num = Number(cleaned)
  if (!Number.isFinite(num)) throw new Error('Invalid amount')
  return Math.round(num * 100)
}
