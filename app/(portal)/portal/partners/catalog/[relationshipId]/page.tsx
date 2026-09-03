'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  ButtonLink,
  Field,
  Input,
  Notice,
  Panel,
  Skeleton,
  Status,
  Table,
  THead,
  TR,
  TH,
  TD,
  Textarea,
  Title,
} from '@/components/studio'

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

const STOCK_LABEL: Record<CatalogItem['stock'], { text: string; tone?: 'success' | 'warning' | 'danger' }> = {
  in_stock: { text: 'In stock', tone: 'success' },
  low_stock: { text: 'Low stock', tone: 'warning' },
  out_of_stock: { text: 'Out of stock', tone: 'danger' },
  unknown: { text: 'Availability unknown' },
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Partner catalogue"
        title={`Order from ${supplierName || 'partner'}.`}
        description={`These are the products ${supplierName || 'this partner'} has published to your workspace, at the prices agreed with you. Your order arrives with them as pending: nothing is reserved until they confirm.`}
        actions={<ButtonLink href="/portal/partners" variant="ghost" size="sm">Back to partners</ButtonLink>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}

      {loading ? (
        <Skeleton height="12rem" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing published yet."
          description={`${supplierName || 'This partner'} has not published any products to you yet.`}
        />
      ) : (
        <>
          <Panel>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Availability</TH>
                    <TH>Your price</TH>
                    <TH>Qty</TH>
                  </TR>
                </THead>
                <tbody>
                  {items.map((item) => {
                    const stock = STOCK_LABEL[item.stock]
                    const out = item.stock === 'out_of_stock'
                    return (
                      <TR key={item.id}>
                        <TD>
                          <p className="text-[var(--sc-ink)]">{item.name}</p>
                          <p className="sc-tiny text-[var(--sc-ink-soft)]">
                            {[item.sku, item.unit].filter(Boolean).join(' · ') || '-'}
                          </p>
                        </TD>
                        <TD>
                          <Status tone={stock.tone}>{stock.text}</Status>
                        </TD>
                        <TD className="st-num">
                          {money(item.unitPrice, item.currency)}
                          {item.taxRate ? (
                            <span className="ml-1 sc-tiny text-[var(--sc-ink-soft)]">+{item.taxRate}%</span>
                          ) : null}
                        </TD>
                        <TD>
                          <Input
                            type="number"
                            min={0}
                            value={qty[item.id] ?? ''}
                            disabled={out}
                            aria-label={`Quantity of ${item.name}`}
                            onChange={(e) => {
                              const n = Number(e.target.value)
                              setQty((prev) => ({ ...prev, [item.id]: Number.isFinite(n) && n > 0 ? n : 0 }))
                            }}
                            className="w-20"
                          />
                        </TD>
                      </TR>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          </Panel>

          <Panel>
            <Title>Your order</Title>
            {lines.length === 0 ? (
              <p className="mt-4 sc-body">Set a quantity above to start an order.</p>
            ) : (
              <div className="mt-4 space-y-4">
                <ul className="space-y-2 sc-body">
                  {lines.map((l) => (
                    <li key={l.item.id} className="flex justify-between gap-4">
                      <span className="min-w-0 truncate text-[var(--sc-ink)]">{l.item.name} × {l.qty}</span>
                      <span className="st-num text-[var(--sc-ink-soft)]">
                        {money(l.item.unitPrice * l.qty, l.item.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-[var(--sc-line)] pt-4 sc-body">
                  <div className="flex justify-between text-[var(--sc-ink-soft)]">
                    <span>Subtotal</span><span className="st-num">{money(subtotal, currency)}</span>
                  </div>
                  <div className="flex justify-between text-[var(--sc-ink-soft)]">
                    <span>Tax</span><span className="st-num">{money(tax, currency)}</span>
                  </div>
                  <div className="mt-2 flex justify-between text-[var(--sc-ink)]">
                    <span>Total</span><span className="st-num">{money(subtotal + tax, currency)}</span>
                  </div>
                </div>
                <Field id="order-notes" label="Notes" hint="Optional">
                  <Textarea
                    id="order-notes"
                    aria-label="Notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Delivery timing, PO reference, anything they should know."
                  />
                </Field>
                <Button
                  type="button"
                  onClick={() => void submit()}
                  disabled={submitting}
                  loading={submitting}
                >
                  Send order
                </Button>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
