'use client'
// components/ads/google/ConversionActionForm.tsx
// Sub-3a Phase 6 Batch 3 F - form for creating a conversion action.

import { useState } from 'react'
import type {
  AdConversionCategory,
  AdConversionCountingType,
  AdConversionAttributionModel,
} from '@/lib/ads/types'

const CATEGORIES: AdConversionCategory[] = [
  'PAGE_VIEW', 'PURCHASE', 'SIGNUP', 'LEAD', 'DOWNLOAD',
  'ADD_TO_CART', 'BEGIN_CHECKOUT', 'SUBSCRIBE_PAID',
  'PHONE_CALL_LEAD', 'IMPORTED_LEAD', 'SUBMIT_LEAD_FORM',
  'BOOK_APPOINTMENT', 'REQUEST_QUOTE', 'GET_DIRECTIONS',
  'OUTBOUND_CLICK', 'CONTACT', 'ENGAGEMENT',
  'STORE_VISIT', 'STORE_SALE',
  'QUALIFIED_LEAD', 'CONVERTED_LEAD', 'OTHER',
]

const ATTRIBUTION_MODELS: AdConversionAttributionModel[] = [
  'LAST_CLICK',
  'GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN',
  'LINEAR',
  'TIME_DECAY',
  'POSITION_BASED',
]

const ATTRIBUTION_LABELS: Record<AdConversionAttributionModel, string> = {
  LAST_CLICK: 'Last click',
  GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN: 'Data-driven',
  LINEAR: 'Linear',
  TIME_DECAY: 'Time decay',
  POSITION_BASED: 'Position-based',
}

interface FormState {
  platform: 'meta' | 'google'
  name: string
  category: AdConversionCategory
  countingType: AdConversionCountingType
  defaultValue: string
  defaultCurrencyCode: string
  alwaysUseDefault: boolean
  attributionModel: AdConversionAttributionModel | ''
  pixelId: string
  customEventType: string
}

const DEFAULT_FORM: FormState = {
  platform: 'google',
  name: '',
  category: 'PURCHASE',
  countingType: 'ONE_PER_CLICK',
  defaultValue: '',
  defaultCurrencyCode: '',
  alwaysUseDefault: false,
  attributionModel: '',
  pixelId: '',
  customEventType: '',
}

interface Props {
  orgSlug: string
  orgId: string
  onCreated?: () => void
}

export function ConversionActionForm({ orgSlug: _orgSlug, orgId, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function patch(partial: Partial<FormState>) {
    setForm((f) => ({ ...f, ...partial }))
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Name is required'
    if (form.platform === 'meta' && !form.pixelId.trim()) return 'Pixel ID is required for Meta'
    return null
  }

  async function submit() {
    const err = validate()
    if (err) { setError(err); return }
    setError(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        platform: form.platform,
        name: form.name.trim(),
        category: form.category,
        countingType: form.countingType,
      }

      const hasValue = form.defaultValue !== '' && !isNaN(Number(form.defaultValue))
      const hasCurrency = form.defaultCurrencyCode.trim().length === 3

      if (hasValue || hasCurrency || form.alwaysUseDefault) {
        body.valueSettings = {
          ...(hasValue ? { defaultValue: Number(form.defaultValue) } : {}),
          ...(hasCurrency ? { defaultCurrencyCode: form.defaultCurrencyCode.trim().toUpperCase() } : {}),
          ...(form.alwaysUseDefault ? { alwaysUseDefault: true } : {}),
        }
      }

      if (form.platform === 'google' && form.attributionModel) {
        body.attributionModel = form.attributionModel
      }

      if (form.platform === 'meta') {
        if (form.pixelId.trim()) body.pixelId = form.pixelId.trim()
        if (form.customEventType.trim()) body.customEventType = form.customEventType.trim()
      }

      const res = await fetch('/api/v1/ads/conversion-actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': orgId,
        },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`)

      setForm(DEFAULT_FORM)
      onCreated?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[color-mix(in_srgb,var(--sc-accent)_60%,transparent)]'
  const labelCls = 'block text-sm font-medium'

  return (
    <div className="space-y-5">
      {/* Platform */}
      <fieldset>
        <legend className={labelCls}>Platform</legend>
        <div className="mt-2 flex gap-4">
          {(['google', 'meta'] as const).map((p) => (
            <label
              key={p}
              className={`flex items-center gap-2 rounded border px-3 py-2 text-sm cursor-pointer transition-colors ${
                form.platform === p
                  ? 'border-[var(--sc-accent)] bg-[color-mix(in_srgb,var(--sc-accent)_5%,transparent)]'
                  : 'border-white/10 hover:bg-white/5'
              }`}
            >
              <input
                type="radio"
                name="ca-platform"
                checked={form.platform === p}
                onChange={() => patch({ platform: p, attributionModel: '', pixelId: '', customEventType: '' })}
                aria-label={p === 'google' ? 'Google' : 'Meta'}
              />
              <span className="capitalize">{p === 'google' ? 'Google' : 'Meta'}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Name */}
      <label className={labelCls}>
        Name *
        <input
          className={inputCls}
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g. Purchase - Checkout page"
          aria-label="Conversion action name"
        />
      </label>

      {/* Category */}
      <label className={labelCls}>
        Category
        <select
          className={inputCls}
          value={form.category}
          onChange={(e) => patch({ category: e.target.value as AdConversionCategory })}
          aria-label="Category"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>

      {/* Counting type */}
      <fieldset>
        <legend className={labelCls}>Counting type</legend>
        <div className="mt-2 space-y-2">
          {(
            [
              { value: 'ONE_PER_CLICK', label: 'One per click', description: 'Recommended - counts one conversion per ad click' },
              { value: 'MANY_PER_CLICK', label: 'Many per click', description: 'Counts every conversion after an ad click' },
            ] as { value: AdConversionCountingType; label: string; description: string }[]
          ).map((ct) => (
            <label
              key={ct.value}
              className={`flex items-start gap-3 rounded border px-3 py-2 text-sm cursor-pointer transition-colors ${
                form.countingType === ct.value
                  ? 'border-[var(--sc-accent)] bg-[color-mix(in_srgb,var(--sc-accent)_5%,transparent)]'
                  : 'border-white/10 hover:bg-white/5'
              }`}
            >
              <input
                type="radio"
                name="ca-counting-type"
                checked={form.countingType === ct.value}
                onChange={() => patch({ countingType: ct.value })}
                className="mt-0.5"
                aria-label={ct.label}
              />
              <div>
                <div className="font-medium">{ct.label}</div>
                <div className="text-xs text-white/50">{ct.description}</div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Value settings */}
      <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-4">
        <p className="text-xs text-white/50 uppercase tracking-wide">Value settings (optional)</p>
        <div className="grid grid-cols-2 gap-4">
          <label className={labelCls}>
            Default value
            <input
              type="number"
              className={inputCls}
              value={form.defaultValue}
              onChange={(e) => patch({ defaultValue: e.target.value })}
              placeholder="0.00"
              min="0"
              step="0.01"
              aria-label="Default value"
            />
          </label>
          <label className={labelCls}>
            Currency (3-letter)
            <input
              className={inputCls}
              value={form.defaultCurrencyCode}
              onChange={(e) => patch({ defaultCurrencyCode: e.target.value })}
              placeholder="USD"
              maxLength={3}
              aria-label="Default currency"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.alwaysUseDefault}
            onChange={(e) => patch({ alwaysUseDefault: e.target.checked })}
            aria-label="Always use default value"
          />
          Always use default value
        </label>
      </div>

      {/* Attribution model - Google only */}
      {form.platform === 'google' && (
        <label className={labelCls}>
          Attribution model (optional)
          <select
            className={inputCls}
            value={form.attributionModel}
            onChange={(e) =>
              patch({ attributionModel: e.target.value as AdConversionAttributionModel | '' })
            }
            aria-label="Attribution model"
          >
            <option value=""> -  platform default - </option>
            {ATTRIBUTION_MODELS.map((m) => (
              <option key={m} value={m}>
                {ATTRIBUTION_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Meta-specific fields */}
      {form.platform === 'meta' && (
        <div className="space-y-4 rounded border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs text-white/50 uppercase tracking-wide">Meta pixel settings</p>
          <label className={labelCls}>
            Pixel ID *
            <input
              className={inputCls}
              value={form.pixelId}
              onChange={(e) => patch({ pixelId: e.target.value })}
              placeholder="1234567890"
              aria-label="Pixel ID"
            />
          </label>
          <label className={labelCls}>
            Custom event type (optional)
            <input
              className={inputCls}
              value={form.customEventType}
              onChange={(e) => patch({ customEventType: e.target.value })}
              placeholder="e.g. CompleteRegistration"
              aria-label="Custom event type"
            />
          </label>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-pib-accent text-sm"
          onClick={submit}
          disabled={submitting}
          aria-label="Create conversion action"
        >
          {submitting ? 'Creating…' : 'Create conversion action'}
        </button>
      </div>
    </div>
  )
}
