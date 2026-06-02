// lib/crm/deals.ts
//
// Fields that must never come from the request body — the route handler
// (via middleware-authoritative ctx) controls these. Stripping them here
// blocks the cross-tenant-via-body-orgId attack at the source.
//
// Mirrors lib/companies/store.ts NEVER_FROM_BODY (commit 1907d8f).

import type { Currency, DealLineItem } from '@/lib/crm/types'

const NEVER_FROM_BODY = new Set([
  'id', 'orgId',
  'createdBy', 'createdByRef', 'createdAt',
  'updatedBy', 'updatedByRef', 'updatedAt',
  'deleted',
])

export function sanitizeDealForWrite(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    if (NEVER_FROM_BODY.has(k)) continue
    out[k] = v
  }
  return out
}

const VALID_CURRENCIES: Currency[] = ['USD', 'EUR', 'ZAR']

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeDealProbability(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('Probability must be a number between 0 and 100')
  }
  return Math.round(value)
}

export function normalizeDealLineItems(value: unknown, fallbackCurrency: Currency): DealLineItem[] | undefined {
  if (value === undefined) return undefined
  if (value === null) return []
  if (!Array.isArray(value)) throw new Error('lineItems must be an array')

  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`lineItems[${index}] must be an object`)
    const item = raw as Record<string, unknown>
    const name = cleanString(item.name)
    if (!name) throw new Error(`lineItems[${index}].name is required`)

    const qty = finiteNumber(item.qty)
    const unitPrice = finiteNumber(item.unitPrice)
    const discount = item.discount === undefined || item.discount === null || item.discount === ''
      ? undefined
      : finiteNumber(item.discount)
    if (qty < 0) throw new Error(`lineItems[${index}].qty must be zero or more`)
    if (unitPrice < 0) throw new Error(`lineItems[${index}].unitPrice must be zero or more`)
    if (discount !== undefined && (discount < 0 || discount > 100)) {
      throw new Error(`lineItems[${index}].discount must be between 0 and 100`)
    }

    const currency = VALID_CURRENCIES.includes(item.currency as Currency) ? item.currency as Currency : fallbackCurrency
    const normalized: DealLineItem = {
      name,
      qty,
      unitPrice,
      total: roundMoney(qty * unitPrice * (1 - (discount ?? 0) / 100)),
      currency,
    }
    const productId = cleanString(item.productId)
    if (productId) normalized.productId = productId
    if (discount !== undefined && discount !== 0) normalized.discount = discount
    return normalized
  })
}

export function normalizeDealCommercialFields(input: Record<string, unknown>, fallbackCurrency: Currency): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('probability' in input) out.probability = normalizeDealProbability(input.probability)
  if ('lostReason' in input) {
    const lostReason = cleanString(input.lostReason)
    out.lostReason = lostReason || null
  }
  if ('lineItems' in input) out.lineItems = normalizeDealLineItems(input.lineItems, fallbackCurrency)
  return out
}
