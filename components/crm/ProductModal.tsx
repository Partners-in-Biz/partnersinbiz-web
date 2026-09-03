'use client'

import { useState, useEffect } from 'react'
import type { Product } from '@/lib/products/types'
import type { Currency } from '@/lib/crm/types'
import { Icon } from '@/components/studio'

interface Props {
  product: Product | null
  orgId?: string
  onSave: (saved: Product) => void
  onClose: () => void
}

const CURRENCIES: Currency[] = ['ZAR', 'USD', 'EUR']

export function ProductModal({ product, orgId, onSave, onClose }: Props) {
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
      const path = isEdit
        ? `/api/v1/crm/products/${product.id}`
        : '/api/v1/crm/products'
      const url = orgId ? `${path}?orgId=${encodeURIComponent(orgId)}` : path
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
      className="pib-dialog-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="pib-dialog-drawer w-full max-w-md">
        {/* Header */}
        <div className="pib-dialog-header">
          <h2 className="pib-dialog-title">
            {isEdit ? 'Edit product' : 'New product'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="pib-dialog-close cursor-pointer"
            aria-label="Close"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>

        {/* Form */}
        <form id="product-form" onSubmit={handleSubmit} className="pib-dialog-body space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="product-name" className="pib-label">
              Name <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              id="product-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="pib-input w-full text-sm"
              placeholder="e.g. Social Media Management"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="product-description" className="pib-label">
              Description
            </label>
            <textarea
              id="product-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="pib-textarea w-full resize-none text-sm"
              placeholder="Optional description"
            />
          </div>

          {/* Unit price + Currency row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="product-unit-price" className="pib-label">
                Unit price <span className="text-[var(--color-error)]">*</span>
              </label>
              <input
                id="product-unit-price"
                type="number"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                step="0.01"
                min="0"
                className="pib-input w-full text-sm"
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="product-currency" className="pib-label">
                Currency
              </label>
              <select
                id="product-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="pib-select w-full cursor-pointer text-sm"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Unit */}
          <div>
            <label htmlFor="product-unit" className="pib-label">
              Unit
            </label>
            <input
              id="product-unit"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="pib-input w-full text-sm"
              placeholder="hr / item / month"
            />
          </div>

          {/* Inline error */}
          {error && (
            <p className="text-sm text-[var(--color-error)] flex items-center gap-1.5">
              <Icon name="error" className="text-[16px]" />
              {error}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="pib-dialog-footer justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-pib-secondary h-8 px-3 text-xs"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="product-form"
            disabled={saving}
            className="btn-pib-primary h-8 gap-1.5 px-3 text-xs"
          >
            <Icon name="save" className="text-[15px]" />
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </div>
    </div>
  )
}
