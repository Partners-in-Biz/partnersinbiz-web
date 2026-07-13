'use client'

import { useState, useEffect } from 'react'
import type { Product } from '@/lib/products/types'
import type { Currency } from '@/lib/crm/types'

interface Props {
  product: Product | null
  onSave: (saved: Product) => void
  onClose: () => void
}

const CURRENCIES: Currency[] = ['ZAR', 'USD', 'EUR']

export function ProductModal({ product, onSave, onClose }: Props) {
  const isEdit = product !== null

  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [unitPrice, setUnitPrice] = useState(product ? String(product.unitPrice) : '')
  const [currency, setCurrency] = useState<Currency>(product?.currency ?? 'ZAR')
  const [unit, setUnit] = useState(product?.unit ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when product changes
  useEffect(() => {
    setName(product?.name ?? '')
    setDescription(product?.description ?? '')
    setUnitPrice(product ? String(product.unitPrice) : '')
    setCurrency(product?.currency ?? 'ZAR')
    setUnit(product?.unit ?? '')
    setError(null)
  }, [product])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    const normalizedPrice = unitPrice.trim()
    if (!normalizedPrice) { setError('Unit price is required.'); return }
    const parsedPrice = Number(normalizedPrice)
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) { setError('Unit price must be a valid non-negative number.'); return }

    setSaving(true)
    setError(null)

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      unitPrice: parsedPrice,
      currency,
      unit: unit.trim() || undefined,
    }

    try {
      const url = isEdit
        ? `/api/v1/crm/products/${product.id}`
        : '/api/v1/crm/products'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const saved: Product = body.data?.product ?? body.data ?? body
      onSave(saved)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md flex flex-col overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]">
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-card-border)] px-4">
          <h2 className="text-sm font-semibold text-on-surface">
            {isEdit ? 'Edit product' : 'New product'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-white/[0.05] hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Form */}
        <form id="product-form" onSubmit={handleSubmit} className="px-4 py-4 space-y-3 overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)] transition-colors"
              placeholder="e.g. Social Media Management"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)] transition-colors resize-none"
              placeholder="Optional description"
            />
          </div>

          {/* Unit price + Currency row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant mb-1">
                Unit price <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                step="0.01"
                min="0"
                className="w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)] transition-colors"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant mb-1">
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)] transition-colors cursor-pointer"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Unit */}
          <div>
            <label className="block text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant mb-1">
              Unit
            </label>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)] transition-colors"
              placeholder="hr / item / month"
            />
          </div>

          {/* Inline error */}
          {error && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">error</span>
              {error}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-card-border)]">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 cursor-pointer items-center rounded-md border border-[var(--color-card-border)] px-3 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="product-form"
            disabled={saving}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[15px]">save</span>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </div>
    </div>
  )
}
