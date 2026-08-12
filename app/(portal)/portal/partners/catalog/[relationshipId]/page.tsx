'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface CatalogItem {
  id: string
  productId: string
  name: string
  sku?: string
  unit?: string
  description?: string
  unitPrice: number
  currency: string
  taxRate?: number
  stock: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown'
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

const STOCK_LABEL: Record<CatalogItem['stock'], { text: string; cls: string }> = {
  in_stock: { text: 'In stock', cls: 'pib-pill-success' },
  low_stock: { text: 'Low stock', cls: 'pib-pill-warn' },
  out_of_stock: { text: 'Out of stock', cls: 'pib-pill-danger' },
  unknown: { text: 'Availability unknown', cls: '' },
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export default function PartnerCatalogPage({ params }: { params: Promise<{ relationshipId: string }> }) {
  const { relationshipId } = use(params)

  const [items, setItems] = useState<CatalogItem[]>([])
  const [supplierName, setSupplierName] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-catalog?view=browse&relationshipId=${encodeURIComponent(relationshipId)}`)
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'This catalogue is not available.')
        return
      }
      setItems((data?.items as CatalogItem[]) ?? [])
      setSupplierName((data?.supplierName as string) ?? '')
    } catch {
      setError('This catalogue is not available.')
    } finally {
      setLoading(false)
    }
  }, [relationshipId])

  useEffect(() => { void load() }, [load])

  const lines = useMemo(
    () => items.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ item: i, qty: qty[i.id] })),
    [items, qty],
  )
  const subtotal = lines.reduce((s, l) => s + l.item.unitPrice * l.qty, 0)
  const tax = lines.reduce((s, l) => s + l.item.unitPrice * l.qty * ((l.item.taxRate ?? 0) / 100), 0)
  const currency = items[0]?.currency ?? 'ZAR'

  async function submit() {
    if (lines.length === 0) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/crm/partner-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationshipId,
          lines: lines.map((l) => ({ catalogItemId: l.item.id, qty: l.qty })),
          notes: notes.trim() || undefined,
        }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not place the order.')
        return
      }
      setNotice(`Order sent to ${supplierName}. They will confirm it before anything is reserved.`)
      setQty({})
      setNotes('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5 p-4">
      <div>
        <Link href="/portal/partners" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
          ← Back to partners
        </Link>
        <p className="eyebrow mt-2">Partner catalogue</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-pib-text)]">
          Order from {supplierName || 'partner'}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          These are the products {supplierName || 'this partner'} has published to your workspace, at the prices
          agreed with you. Your order arrives with them as pending — nothing is reserved until they confirm.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading catalogue…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4 text-sm text-[var(--color-pib-text-muted)]">
          {supplierName || 'This partner'} hasn&rsquo;t published any products to you yet.
        </p>
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Availability</th>
                    <th className="px-4 py-2">Your price</th>
                    <th className="px-4 py-2 w-28">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const stock = STOCK_LABEL[item.stock]
                    const out = item.stock === 'out_of_stock'
                    return (
                      <tr key={item.id} className="border-b border-[var(--color-pib-line)] last:border-0">
                        <td className="px-4 py-2">
                          <p className="text-[var(--color-pib-text)]">{item.name}</p>
                          <p className="text-[11px] text-[var(--color-pib-text-muted)]">
                            {[item.sku, item.unit].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`pib-pill px-2 py-0.5 text-[10px] ${stock.cls}`}>{stock.text}</span>
                        </td>
                        <td className="px-4 py-2 font-mono text-[var(--color-pib-text)]">
                          {money(item.unitPrice, item.currency)}
                          {item.taxRate ? (
                            <span className="ml-1 text-[10px] text-[var(--color-pib-text-muted)]">+{item.taxRate}%</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={0}
                            value={qty[item.id] ?? ''}
                            disabled={out}
                            aria-label={`Quantity of ${item.name}`}
                            onChange={(e) => {
                              const n = Number(e.target.value)
                              setQty((prev) => ({ ...prev, [item.id]: Number.isFinite(n) && n > 0 ? n : 0 }))
                            }}
                            className="w-20 rounded-md border border-[var(--color-pib-line)] bg-black/30 px-2 py-1 text-sm text-[var(--color-pib-text)] disabled:opacity-40"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
            <h2 className="mb-2 text-sm font-semibold text-[var(--color-pib-text)]">Your order</h2>
            {lines.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Set a quantity above to start an order.</p>
            ) : (
              <>
                <ul className="mb-3 space-y-1 text-sm">
                  {lines.map((l) => (
                    <li key={l.item.id} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate text-[var(--color-pib-text)]">{l.item.name} × {l.qty}</span>
                      <span className="font-mono text-[var(--color-pib-text-muted)]">
                        {money(l.item.unitPrice * l.qty, l.item.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mb-3 border-t border-[var(--color-pib-line)] pt-2 text-sm">
                  <div className="flex justify-between text-[var(--color-pib-text-muted)]">
                    <span>Subtotal</span><span className="font-mono">{money(subtotal, currency)}</span>
                  </div>
                  <div className="flex justify-between text-[var(--color-pib-text-muted)]">
                    <span>Tax</span><span className="font-mono">{money(tax, currency)}</span>
                  </div>
                  <div className="mt-1 flex justify-between font-semibold text-[var(--color-pib-text)]">
                    <span>Total</span><span className="font-mono">{money(subtotal + tax, currency)}</span>
                  </div>
                </div>
                <label htmlFor="order-notes" className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                  Notes (optional)
                </label>
                <textarea
                  id="order-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Delivery timing, PO reference, anything they should know."
                  className="mb-3 w-full rounded-lg border border-[var(--color-pib-line)] bg-black/20 px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-[var(--color-accent-v2)]"
                />
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={submitting}
                  className="rounded-lg bg-[var(--color-accent-v2)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {submitting ? 'Sending…' : 'Send order'}
                </button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
