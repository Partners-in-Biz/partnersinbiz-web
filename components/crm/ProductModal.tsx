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
    const parsedPrice = Number(unitPrice)
    if (isNaN(parsedPrice) || parsedPrice < 0) { setError('Unit price must be a valid non-negative number.'); return }

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
      <div className="bento-card !p-0 w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-pib-line)]">
          <h2 className="text-sm font-semibold">
            {isEdit ? 'Edit product' : 'New product'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-pib-text-muted)] mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors"
              placeholder="e.g. Social Media Management"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-pib-text-muted)] mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors resize-none"
              placeholder="Optional description"
            />
          </div>

          {/* Unit price + Currency row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-pib-text-muted)] mb-1">
                Unit price <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                step="0.01"
                min="0"
                className="w-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-pib-text-muted)] mb-1">
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="w-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors cursor-pointer"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Unit */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-pib-text-muted)] mb-1">
              Unit
            </label>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors"
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
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--color-pib-line)]">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer btn-pib-secondary text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            form=""
            onClick={handleSubmit}
            disabled={saving}
            className="cursor-pointer btn-pib-accent text-sm disabled:opacity-60 flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">save</span>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </div>
    </div>
  )
}
