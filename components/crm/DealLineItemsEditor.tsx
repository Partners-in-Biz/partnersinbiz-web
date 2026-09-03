'use client'

import { useState } from 'react'
import type { DealLineItem, Currency } from '@/lib/crm/types'
import type { Product } from '@/lib/products/types'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { ProductPicker } from './ProductPicker'
import { Icon } from '@/components/studio'

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

  const thCls = 'pib-label text-left px-2 py-1.5'
  const tdCls = 'px-2 py-1.5'
  const inputCls = 'pib-input h-8 w-full text-xs text-right'
  const numInputCls = `${inputCls} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`

  return (
    <div className="space-y-1">
      <div className="pib-surface pib-surface-table overflow-x-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead>
            <tr className="border-b border-[var(--color-pib-line)]">
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
                  className="px-4 py-4"
                >
                  <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-center">
                    <Icon name="request_quote" className="flex h-8 w-8 items-center justify-center rounded-md text-[16px]" />
                    <div>
                      <p className="pib-label">
                        Quote value missing
                      </p>
                      <h3 className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">Build the first quote line</h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                        Add a product, service, or ad-hoc item so sales, delivery, and leadership can see what this opportunity is worth.
                      </p>
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={openAddRow}
                        className="btn-pib-secondary h-8 gap-1.5 px-3 text-xs"
                      >
                        <Icon name="add" className="text-[14px]" />
                        Add first quote item
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {items.map((item, idx) => (
              <tr key={idx} className="border-b border-[var(--color-pib-line)] transition hover:bg-[var(--color-row-hover)] last:border-0">
                <td className={tdCls}>
                  {readOnly ? (
                    <span className="text-xs text-[var(--color-pib-text)]">{item.name}</span>
                  ) : (
                    <input
                      type="text"
                      value={item.name}
                      onChange={e => updateItem(idx, { name: e.target.value })}
                      aria-label={`Line item ${idx + 1} name`}
                      className="pib-input h-8 w-full text-xs"
                    />
                  )}
                </td>
                <td className={tdCls}>
                  {readOnly ? (
                    <span className="text-xs text-right block font-mono">{item.qty}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={item.qty}
                      onChange={e => updateItem(idx, { qty: parseFloat(e.target.value) || 0 })}
                      aria-label={`Line item ${idx + 1} quantity`}
                      className={numInputCls}
                    />
                  )}
                </td>
                <td className={tdCls}>
                  {readOnly ? (
                    <span className="text-xs text-right block font-mono">{item.unitPrice.toFixed(2)}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unitPrice}
                      onChange={e => updateItem(idx, { unitPrice: parseFloat(e.target.value) || 0 })}
                      aria-label={`Line item ${idx + 1} unit price`}
                      className={numInputCls}
                    />
                  )}
                </td>
                <td className={tdCls}>
                  {readOnly ? (
                    <span className="text-xs text-right block font-mono">{item.discount ?? 0}%</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={item.discount ?? 0}
                      onChange={e => updateItem(idx, { discount: parseFloat(e.target.value) || undefined })}
                      aria-label={`Line item ${idx + 1} discount`}
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
                      className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-error)] transition-colors"
                    >
                      <Icon name="delete" className="text-[16px]" />
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {/* Draft / add row */}
            {addingRow && (
              <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-row-hover)]" onKeyDown={handleDraftKeyDown}>
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
                      aria-label="New line item name"
                      className="pib-input mt-1 h-8 w-full text-xs"
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
                    aria-label="New line item quantity"
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
                    aria-label="New line item unit price"
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
                    aria-label="New line item discount"
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
                      className="cursor-pointer text-emerald-500 transition-colors hover:text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Icon name="check" className="text-[16px]" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelDraft}
                      aria-label="Cancel quote item draft"
                      className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
                    >
                      <Icon name="close" className="text-[16px]" />
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>

          {/* Subtotal row */}
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t border-[var(--color-pib-line)]">
                <td
                  colSpan={readOnly ? 4 : 5}
                  className="pib-label px-2 py-2 text-right"
                >
                  Subtotal
                </td>
                <td className="px-2 py-1.5 font-mono text-right font-medium text-[var(--color-pib-text)]">
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
          className="cursor-pointer flex items-center gap-1.5 text-xs text-[var(--color-pib-accent)] hover:opacity-80 transition-opacity pt-1"
        >
          <Icon name="add" className="text-[14px]" />
          Add item
        </button>
      )}
    </div>
  )
}
