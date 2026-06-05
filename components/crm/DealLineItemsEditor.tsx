'use client'

import { useState } from 'react'
import type { DealLineItem, Currency } from '@/lib/crm/types'
import type { Product } from '@/lib/products/types'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { ProductPicker } from './ProductPicker'

export interface DealLineItemsEditorProps {
  value: DealLineItem[]
  onChange: (items: DealLineItem[]) => void
  currency: Currency
  orgId: string
  orgScope?: PortalOrgRouteScope
  readOnly?: boolean
}

function computeTotal(qty: number, unitPrice: number, discount?: number): number {
  const total = qty * unitPrice * (1 - (discount ?? 0) / 100)
  return Math.round(total * 100) / 100
}

function fmtCurrency(currency: Currency, amount: number): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

// ── Blank new-item state ───────────────────────────────────────────────────────

interface DraftItem {
  productId?: string
  name: string
  qty: number
  unitPrice: number
  discount: number
}

const BLANK_DRAFT: DraftItem = { name: '', qty: 1, unitPrice: 0, discount: 0 }

// ── Main component ────────────────────────────────────────────────────────────

export function DealLineItemsEditor({ value, onChange, currency, orgId, orgScope, readOnly = false }: DealLineItemsEditorProps) {
  const [addingRow, setAddingRow] = useState(false)
  const [draft, setDraft] = useState<DraftItem>(BLANK_DRAFT)

  const items = value ?? []

  // ── Row mutation helpers ──────────────────────────────────────────────────

  function updateItem(index: number, patch: Partial<DealLineItem>) {
    const updated = items.map((item, i) => {
      if (i !== index) return item
      const merged = { ...item, ...patch }
      merged.total = computeTotal(merged.qty, merged.unitPrice, merged.discount)
      return merged
    })
    onChange(updated)
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index))
  }

  // ── Draft row helpers ─────────────────────────────────────────────────────

  function openAddRow() {
    setDraft(BLANK_DRAFT)
    setAddingRow(true)
  }

  function cancelDraft() {
    setAddingRow(false)
    setDraft(BLANK_DRAFT)
  }

  function confirmDraft() {
    if (!draft.name.trim()) return
    const total = computeTotal(draft.qty, draft.unitPrice, draft.discount)
    const newItem: DealLineItem = {
      productId: draft.productId,
      name: draft.name.trim(),
      qty: draft.qty,
      unitPrice: draft.unitPrice,
      discount: draft.discount || undefined,
      total,
      currency,
    }
    onChange([...items, newItem])
    setAddingRow(false)
    setDraft(BLANK_DRAFT)
  }

  function handleDraftKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); confirmDraft() }
    if (e.key === 'Escape') cancelDraft()
  }

  function handleProductSelect(product: Product | null) {
    if (product) {
      setDraft(d => ({ ...d, productId: product.id, name: product.name, unitPrice: product.unitPrice }))
    } else {
      setDraft(d => ({ ...d, productId: undefined }))
    }
  }

  function handleAdHoc(name: string) {
    setDraft(d => ({ ...d, name, productId: undefined }))
  }

  // ── Subtotal ──────────────────────────────────────────────────────────────

  const subtotal = items.reduce((sum, item) => sum + item.total, 0)

  // ── Render ────────────────────────────────────────────────────────────────

  const thCls = 'text-left text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] px-2 py-2'
  const tdCls = 'px-2 py-2'
  const inputCls = 'pib-input w-full text-sm text-right'
  const numInputCls = `${inputCls} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded-lg border border-[var(--color-pib-line)]">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="border-b border-[var(--color-pib-line)] bg-white/[0.02]">
              <th className={`${thCls} text-left w-[35%]`}>Product / Name</th>
              <th className={`${thCls} text-right w-[10%]`}>Qty</th>
              <th className={`${thCls} text-right w-[18%]`}>Unit Price</th>
              <th className={`${thCls} text-right w-[12%]`}>Disc %</th>
              <th className={`${thCls} text-right w-[18%]`}>Total</th>
              {!readOnly && <th className={`${thCls} w-[7%]`} />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !addingRow && (
              <tr>
                <td
                  colSpan={readOnly ? 5 : 6}
                  className="px-4 py-6"
                >
                  <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[18px] text-[var(--color-accent-v2)]"
                    >
                      request_quote
                    </span>
                    <div>
                      <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                        Quote value missing
                      </p>
                      <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Build the first quote line</h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                        Add a product, service, or ad-hoc item so sales, delivery, and leadership can see what this opportunity is worth.
                      </p>
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={openAddRow}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] px-3 py-2 text-xs font-medium text-[var(--color-pib-text)] transition-colors hover:border-[var(--color-accent-v2)] hover:text-[var(--color-accent-v2)]"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">add</span>
                        Add first quote item
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {items.map((item, idx) => (
              <tr key={idx} className="border-b border-[var(--color-pib-line)] last:border-0">
                <td className={tdCls}>
                  {readOnly ? (
                    <span className="text-sm text-[var(--color-pib-text)]">{item.name}</span>
                  ) : (
                    <input
                      type="text"
                      value={item.name}
                      onChange={e => updateItem(idx, { name: e.target.value })}
                      className="pib-input w-full text-sm"
                    />
                  )}
                </td>
                <td className={tdCls}>
                  {readOnly ? (
                    <span className="text-sm text-right block font-mono">{item.qty}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={item.qty}
                      onChange={e => updateItem(idx, { qty: parseFloat(e.target.value) || 0 })}
                      className={numInputCls}
                    />
                  )}
                </td>
                <td className={tdCls}>
                  {readOnly ? (
                    <span className="text-sm text-right block font-mono">{item.unitPrice.toFixed(2)}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unitPrice}
                      onChange={e => updateItem(idx, { unitPrice: parseFloat(e.target.value) || 0 })}
                      className={numInputCls}
                    />
                  )}
                </td>
                <td className={tdCls}>
                  {readOnly ? (
                    <span className="text-sm text-right block font-mono">{item.discount ?? 0}%</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={item.discount ?? 0}
                      onChange={e => updateItem(idx, { discount: parseFloat(e.target.value) || undefined })}
                      className={numInputCls}
                    />
                  )}
                </td>
                <td className={`${tdCls} font-mono text-right text-[var(--color-pib-text)]`}>
                  {fmtCurrency(currency, item.total)}
                </td>
                {!readOnly && (
                  <td className={`${tdCls} text-center`}>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      aria-label={`Remove quote item ${item.name || `line ${idx + 1}`}`}
                      className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-red-400 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {/* Draft / add row */}
            {addingRow && (
              <tr className="border-b border-[var(--color-pib-line)] bg-white/[0.02]" onKeyDown={handleDraftKeyDown}>
                <td className={tdCls}>
                  <ProductPicker
                    orgId={orgId}
                    orgScope={orgScope}
                    onSelect={handleProductSelect}
                    onAdHoc={handleAdHoc}
                    placeholder="Product name…"
                  />
                  {/* Show name input when ad-hoc name set but no product selected */}
                  {draft.name && !draft.productId && (
                    <input
                      type="text"
                      value={draft.name}
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                      placeholder="Item name"
                      className="pib-input w-full text-sm mt-1"
                    />
                  )}
                </td>
                <td className={tdCls}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.qty}
                    onChange={e => setDraft(d => ({ ...d, qty: parseFloat(e.target.value) || 0 }))}
                    className={numInputCls}
                  />
                </td>
                <td className={tdCls}>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={draft.unitPrice}
                    onChange={e => setDraft(d => ({ ...d, unitPrice: parseFloat(e.target.value) || 0 }))}
                    className={numInputCls}
                  />
                </td>
                <td className={tdCls}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={draft.discount}
                    onChange={e => setDraft(d => ({ ...d, discount: parseFloat(e.target.value) || 0 }))}
                    className={numInputCls}
                  />
                </td>
                <td className={`${tdCls} font-mono text-right text-[var(--color-pib-text-muted)]`}>
                  {fmtCurrency(currency, computeTotal(draft.qty, draft.unitPrice, draft.discount))}
                </td>
                <td className={`${tdCls} text-center`}>
                  <div className="flex items-center gap-1 justify-center">
                    <button
                      type="button"
                      onClick={confirmDraft}
                      disabled={!draft.name.trim()}
                      aria-label="Add quote item"
                      className="cursor-pointer text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    </button>
                    <button
                      type="button"
                      onClick={cancelDraft}
                      aria-label="Cancel quote item draft"
                      className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>

          {/* Subtotal row */}
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t border-[var(--color-pib-line)] bg-white/[0.02]">
                <td
                  colSpan={readOnly ? 4 : 5}
                  className="px-2 py-2 text-right text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]"
                >
                  Subtotal
                </td>
                <td className="px-2 py-2 font-mono text-right font-semibold text-[var(--color-pib-text)]">
                  {fmtCurrency(currency, subtotal)}
                </td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {!readOnly && !addingRow && items.length > 0 && (
        <button
          type="button"
          onClick={openAddRow}
          className="cursor-pointer flex items-center gap-1.5 text-xs text-[var(--color-accent-v2)] hover:opacity-80 transition-opacity pt-1"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Add item
        </button>
      )}
    </div>
  )
}
