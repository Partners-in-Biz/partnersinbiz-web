'use client'
// components/ads/google/RdaAssetEditor.tsx
// Standalone RDA (Responsive Display Ad) asset editor.
// Used in DisplayCampaignBuilder Step 3 and ad detail pages.
// Sub-3a Phase 3 Batch 2 Agent D.

import type { RdaAssets } from '@/lib/ads/providers/google/display-types'

interface Props {
  value: RdaAssets
  onChange: (v: RdaAssets) => void
  disabled?: boolean
}

const CTA_OPTIONS = [
  { value: '', label: '— None (auto) —' },
  { value: 'APPLY_NOW', label: 'Apply now' },
  { value: 'BOOK_NOW', label: 'Book now' },
  { value: 'CONTACT_US', label: 'Contact us' },
  { value: 'DOWNLOAD', label: 'Download' },
  { value: 'LEARN_MORE', label: 'Learn more' },
  { value: 'SHOP_NOW', label: 'Shop now' },
  { value: 'SIGN_UP', label: 'Sign up' },
  { value: 'SUBSCRIBE', label: 'Subscribe' },
] as const

function CharCounter({ len, max }: { len: number; max: number }) {
  return (
    <span
      className={`ml-1 text-xs tabular-nums ${len > max ? 'text-red-400' : 'text-white/30'}`}
    >
      {len}/{max}
    </span>
  )
}

/** Generic image-URL list section */
function ImageUrlList({
  label,
  hint,
  items,
  max,
  disabled,
  onAdd,
  onRemove,
  onPatch,
  ariaPrefix,
}: {
  label: string
  hint: string
  items: string[]
  max: number
  disabled: boolean
  onAdd: () => void
  onRemove: (i: number) => void
  onPatch: (i: number, v: string) => void
  ariaPrefix: string
}) {
  const btnAdd =
    'text-xs text-[#F5A623] border border-[#F5A623]/40 rounded px-2 py-1 hover:bg-[#F5A623]/10 disabled:opacity-40 disabled:cursor-not-allowed'
  const btnRemove =
    'ml-2 text-xs text-white/30 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed'
  const inputCls =
    'flex-1 rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm focus:outline-none focus:border-[#F5A623]/60 disabled:opacity-50'

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">
          {label}{' '}
          <span className="text-white/40 text-xs font-normal">{hint}</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40 tabular-nums">
            {items.length} / {max}
          </span>
          <button
            type="button"
            className={btnAdd}
            onClick={onAdd}
            disabled={disabled || items.length >= max}
            aria-label={`Add ${label}`}
          >
            + Add
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((url, idx) => (
          <div key={idx} className="flex items-center">
            <input
              type="url"
              className={inputCls}
              value={url}
              onChange={(e) => onPatch(idx, e.target.value)}
              disabled={disabled}
              placeholder="https://example.com/image.jpg"
              aria-label={`${ariaPrefix} ${idx + 1}`}
            />
            <button
              type="button"
              className={btnRemove}
              onClick={() => onRemove(idx)}
              disabled={disabled || items.length <= 1}
              aria-label={`Remove ${ariaPrefix} ${idx + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Generic short-text list with character counter */
function TextList({
  label,
  hint,
  items,
  min,
  max,
  maxLen,
  disabled,
  onAdd,
  onRemove,
  onPatch,
  ariaPrefix,
}: {
  label: string
  hint: string
  items: string[]
  min: number
  max: number
  maxLen: number
  disabled: boolean
  onAdd: () => void
  onRemove: (i: number) => void
  onPatch: (i: number, v: string) => void
  ariaPrefix: string
}) {
  const btnAdd =
    'text-xs text-[#F5A623] border border-[#F5A623]/40 rounded px-2 py-1 hover:bg-[#F5A623]/10 disabled:opacity-40 disabled:cursor-not-allowed'
  const btnRemove =
    'ml-2 text-xs text-white/30 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed'
  const inputCls =
    'flex-1 rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm focus:outline-none focus:border-[#F5A623]/60 disabled:opacity-50'

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">
          {label}{' '}
          <span className="text-white/40 text-xs font-normal">{hint}</span>
        </h3>
        <button
          type="button"
          className={btnAdd}
          onClick={onAdd}
          disabled={disabled || items.length >= max}
          aria-label={`Add ${label}`}
        >
          + Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((text, idx) => (
          <div key={idx} className="flex items-center">
            <input
              type="text"
              className={inputCls}
              value={text}
              maxLength={maxLen + 5}
              onChange={(e) => onPatch(idx, e.target.value)}
              disabled={disabled}
              placeholder={`${label} ${idx + 1}`}
              aria-label={`${ariaPrefix} ${idx + 1}`}
            />
            <CharCounter len={text.length} max={maxLen} />
            <button
              type="button"
              className={btnRemove}
              onClick={() => onRemove(idx)}
              disabled={disabled || items.length <= min}
              aria-label={`Remove ${ariaPrefix} ${idx + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

export function RdaAssetEditor({ value, onChange, disabled = false }: Props) {
  /* --- Marketing images --- */
  function patchMarketingImage(i: number, v: string) {
    const u = [...value.marketingImages]
    u[i] = v
    onChange({ ...value, marketingImages: u })
  }
  function addMarketingImage() {
    if (value.marketingImages.length >= 15) return
    onChange({ ...value, marketingImages: [...value.marketingImages, ''] })
  }
  function removeMarketingImage(i: number) {
    if (value.marketingImages.length <= 1) return
    onChange({ ...value, marketingImages: value.marketingImages.filter((_, idx) => idx !== i) })
  }

  /* --- Square marketing images --- */
  function patchSquareMarketingImage(i: number, v: string) {
    const u = [...value.squareMarketingImages]
    u[i] = v
    onChange({ ...value, squareMarketingImages: u })
  }
  function addSquareMarketingImage() {
    if (value.squareMarketingImages.length >= 15) return
    onChange({ ...value, squareMarketingImages: [...value.squareMarketingImages, ''] })
  }
  function removeSquareMarketingImage(i: number) {
    if (value.squareMarketingImages.length <= 1) return
    onChange({
      ...value,
      squareMarketingImages: value.squareMarketingImages.filter((_, idx) => idx !== i),
    })
  }

  /* --- Logo images (optional, min 0) --- */
  const logoImages = value.logoImages ?? []
  function patchLogoImage(i: number, v: string) {
    const u = [...logoImages]
    u[i] = v
    onChange({ ...value, logoImages: u })
  }
  function addLogoImage() {
    if (logoImages.length >= 5) return
    onChange({ ...value, logoImages: [...logoImages, ''] })
  }
  function removeLogoImage(i: number) {
    const updated = logoImages.filter((_, idx) => idx !== i)
    onChange({ ...value, logoImages: updated.length > 0 ? updated : undefined })
  }

  /* --- Square logo images (optional, min 0) --- */
  const squareLogoImages = value.squareLogoImages ?? []
  function patchSquareLogoImage(i: number, v: string) {
    const u = [...squareLogoImages]
    u[i] = v
    onChange({ ...value, squareLogoImages: u })
  }
  function addSquareLogoImage() {
    if (squareLogoImages.length >= 5) return
    onChange({ ...value, squareLogoImages: [...squareLogoImages, ''] })
  }
  function removeSquareLogoImage(i: number) {
    const updated = squareLogoImages.filter((_, idx) => idx !== i)
    onChange({ ...value, squareLogoImages: updated.length > 0 ? updated : undefined })
  }

  /* --- Headlines --- */
  function patchHeadline(i: number, v: string) {
    const u = [...value.headlines]
    u[i] = v
    onChange({ ...value, headlines: u })
  }
  function addHeadline() {
    if (value.headlines.length >= 5) return
    onChange({ ...value, headlines: [...value.headlines, ''] })
  }
  function removeHeadline(i: number) {
    if (value.headlines.length <= 1) return
    onChange({ ...value, headlines: value.headlines.filter((_, idx) => idx !== i) })
  }

  /* --- Long headlines --- */
  function patchLongHeadline(i: number, v: string) {
    const u = [...value.longHeadlines]
    u[i] = v
    onChange({ ...value, longHeadlines: u })
  }
  function addLongHeadline() {
    if (value.longHeadlines.length >= 5) return
    onChange({ ...value, longHeadlines: [...value.longHeadlines, ''] })
  }
  function removeLongHeadline(i: number) {
    if (value.longHeadlines.length <= 1) return
    onChange({ ...value, longHeadlines: value.longHeadlines.filter((_, idx) => idx !== i) })
  }

  /* --- Descriptions --- */
  function patchDescription(i: number, v: string) {
    const u = [...value.descriptions]
    u[i] = v
    onChange({ ...value, descriptions: u })
  }
  function addDescription() {
    if (value.descriptions.length >= 5) return
    onChange({ ...value, descriptions: [...value.descriptions, ''] })
  }
  function removeDescription(i: number) {
    if (value.descriptions.length <= 1) return
    onChange({ ...value, descriptions: value.descriptions.filter((_, idx) => idx !== i) })
  }

  /* --- Landing URLs --- */
  function patchUrl(i: number, v: string) {
    const u = [...value.finalUrls]
    u[i] = v
    onChange({ ...value, finalUrls: u })
  }
  function addUrl() {
    onChange({ ...value, finalUrls: [...value.finalUrls, ''] })
  }
  function removeUrl(i: number) {
    if (value.finalUrls.length <= 1) return
    onChange({ ...value, finalUrls: value.finalUrls.filter((_, idx) => idx !== i) })
  }

  const inputCls =
    'flex-1 rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm focus:outline-none focus:border-[#F5A623]/60 disabled:opacity-50'
  const labelCls = 'block text-sm font-medium'

  return (
    <div className="space-y-6">
      {/* Marketing images */}
      <ImageUrlList
        label="Marketing images"
        hint="(1–15, landscape)"
        items={value.marketingImages}
        max={15}
        disabled={disabled}
        onAdd={addMarketingImage}
        onRemove={removeMarketingImage}
        onPatch={patchMarketingImage}
        ariaPrefix="Marketing image"
      />

      {/* Square marketing images */}
      <ImageUrlList
        label="Square marketing images"
        hint="(1–15, 1:1 ratio)"
        items={value.squareMarketingImages}
        max={15}
        disabled={disabled}
        onAdd={addSquareMarketingImage}
        onRemove={removeSquareMarketingImage}
        onPatch={patchSquareMarketingImage}
        ariaPrefix="Square marketing image"
      />

      {/* Logo images (optional) */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">
            Logo images{' '}
            <span className="text-white/40 text-xs font-normal">(0–5, optional, landscape)</span>
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 tabular-nums">
              {logoImages.length} / 5
            </span>
            <button
              type="button"
              className="text-xs text-[#F5A623] border border-[#F5A623]/40 rounded px-2 py-1 hover:bg-[#F5A623]/10 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={addLogoImage}
              disabled={disabled || logoImages.length >= 5}
              aria-label="Add logo image"
            >
              + Add
            </button>
          </div>
        </div>
        {logoImages.length === 0 && (
          <p className="text-xs text-white/30 italic">No logo images added (optional).</p>
        )}
        <div className="space-y-2">
          {logoImages.map((url, idx) => (
            <div key={idx} className="flex items-center">
              <input
                type="url"
                className={inputCls}
                value={url}
                onChange={(e) => patchLogoImage(idx, e.target.value)}
                disabled={disabled}
                placeholder="https://example.com/logo.png"
                aria-label={`Logo image ${idx + 1}`}
              />
              <button
                type="button"
                className="ml-2 text-xs text-white/30 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={() => removeLogoImage(idx)}
                disabled={disabled}
                aria-label={`Remove logo image ${idx + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Square logo images (optional) */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">
            Square logo images{' '}
            <span className="text-white/40 text-xs font-normal">(0–5, optional, 1:1 ratio)</span>
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 tabular-nums">
              {squareLogoImages.length} / 5
            </span>
            <button
              type="button"
              className="text-xs text-[#F5A623] border border-[#F5A623]/40 rounded px-2 py-1 hover:bg-[#F5A623]/10 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={addSquareLogoImage}
              disabled={disabled || squareLogoImages.length >= 5}
              aria-label="Add square logo image"
            >
              + Add
            </button>
          </div>
        </div>
        {squareLogoImages.length === 0 && (
          <p className="text-xs text-white/30 italic">No square logo images added (optional).</p>
        )}
        <div className="space-y-2">
          {squareLogoImages.map((url, idx) => (
            <div key={idx} className="flex items-center">
              <input
                type="url"
                className={inputCls}
                value={url}
                onChange={(e) => patchSquareLogoImage(idx, e.target.value)}
                disabled={disabled}
                placeholder="https://example.com/square-logo.png"
                aria-label={`Square logo image ${idx + 1}`}
              />
              <button
                type="button"
                className="ml-2 text-xs text-white/30 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={() => removeSquareLogoImage(idx)}
                disabled={disabled}
                aria-label={`Remove square logo image ${idx + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Headlines */}
      <TextList
        label="Headlines"
        hint="(1–5, max 30 chars)"
        items={value.headlines}
        min={1}
        max={5}
        maxLen={30}
        disabled={disabled}
        onAdd={addHeadline}
        onRemove={removeHeadline}
        onPatch={patchHeadline}
        ariaPrefix="Headline"
      />

      {/* Long headlines */}
      <TextList
        label="Long headlines"
        hint="(1–5, max 90 chars)"
        items={value.longHeadlines}
        min={1}
        max={5}
        maxLen={90}
        disabled={disabled}
        onAdd={addLongHeadline}
        onRemove={removeLongHeadline}
        onPatch={patchLongHeadline}
        ariaPrefix="Long headline"
      />

      {/* Descriptions */}
      <TextList
        label="Descriptions"
        hint="(1–5, max 90 chars)"
        items={value.descriptions}
        min={1}
        max={5}
        maxLen={90}
        disabled={disabled}
        onAdd={addDescription}
        onRemove={removeDescription}
        onPatch={patchDescription}
        ariaPrefix="Description"
      />

      {/* Business name + CTA */}
      <section>
        <h3 className="text-sm font-medium mb-3">Business details</h3>
        <div className="space-y-3">
          <label className={labelCls}>
            Business name{' '}
            <span className="text-white/40 text-xs font-normal">(required)</span>
            <input
              type="text"
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60 disabled:opacity-50"
              value={value.businessName}
              maxLength={30}
              onChange={(e) => onChange({ ...value, businessName: e.target.value })}
              disabled={disabled}
              placeholder="Client Business Name"
              aria-label="Business name"
            />
          </label>

          <label className={labelCls}>
            Call to action{' '}
            <span className="text-white/40 text-xs font-normal">(optional)</span>
            <select
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60 disabled:opacity-50"
              value={value.callToActionText ?? ''}
              onChange={(e) => {
                const v = e.target.value as RdaAssets['callToActionText']
                onChange({ ...value, callToActionText: v || undefined })
              }}
              disabled={disabled}
              aria-label="Call to action"
            >
              {CTA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* Landing URLs */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">
            Landing URLs{' '}
            <span className="text-white/40 text-xs font-normal">(at least one required)</span>
          </h3>
          <button
            type="button"
            className="text-xs text-[#F5A623] border border-[#F5A623]/40 rounded px-2 py-1 hover:bg-[#F5A623]/10 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={addUrl}
            disabled={disabled}
            aria-label="Add landing URL"
          >
            + Add URL
          </button>
        </div>
        <div className="space-y-2">
          {value.finalUrls.map((url, idx) => (
            <div key={idx} className="flex items-center">
              <input
                type="url"
                className={inputCls}
                value={url}
                onChange={(e) => patchUrl(idx, e.target.value)}
                disabled={disabled}
                placeholder="https://example.com/landing"
                aria-label={`Landing URL ${idx + 1}`}
              />
              <button
                type="button"
                className="ml-2 text-xs text-white/30 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={() => removeUrl(idx)}
                disabled={disabled || value.finalUrls.length <= 1}
                aria-label={`Remove landing URL ${idx + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
