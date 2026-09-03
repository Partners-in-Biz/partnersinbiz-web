'use client'
// components/ads/google/RsaAssetEditor.tsx
// Standalone RSA (Responsive Search Ad) asset editor.
// Used in SearchCampaignBuilder Step 3 and ad detail pages.
// Sub-3a Phase 2 Batch 4.

import type { RsaAssets } from '@/lib/ads/providers/google/ads'

export type { RsaAssets }

interface Props {
  value: RsaAssets
  onChange: (v: RsaAssets) => void
  disabled?: boolean
}

function CharCounter({ len, max }: { len: number; max: number }) {
  return (
    <span
      className={`ml-1 text-xs tabular-nums ${
        len > max ? 'text-[var(--st-danger)]' : 'text-white/30'
      }`}
    >
      {len}/{max}
    </span>
  )
}

export function RsaAssetEditor({ value, onChange, disabled = false }: Props) {
  function patchHeadline(idx: number, text: string) {
    const updated = value.headlines.map((h, i) => (i === idx ? { ...h, text } : h))
    onChange({ ...value, headlines: updated })
  }

  function addHeadline() {
    if (value.headlines.length >= 15) return
    onChange({ ...value, headlines: [...value.headlines, { text: '' }] })
  }

  function removeHeadline(idx: number) {
    if (value.headlines.length <= 3) return
    onChange({ ...value, headlines: value.headlines.filter((_, i) => i !== idx) })
  }

  function patchDescription(idx: number, text: string) {
    const updated = value.descriptions.map((d, i) => (i === idx ? { ...d, text } : d))
    onChange({ ...value, descriptions: updated })
  }

  function addDescription() {
    if (value.descriptions.length >= 4) return
    onChange({ ...value, descriptions: [...value.descriptions, { text: '' }] })
  }

  function removeDescription(idx: number) {
    if (value.descriptions.length <= 2) return
    onChange({ ...value, descriptions: value.descriptions.filter((_, i) => i !== idx) })
  }

  function patchUrl(idx: number, url: string) {
    const updated = value.finalUrls.map((u, i) => (i === idx ? url : u))
    onChange({ ...value, finalUrls: updated })
  }

  function addUrl() {
    onChange({ ...value, finalUrls: [...value.finalUrls, ''] })
  }

  function removeUrl(idx: number) {
    if (value.finalUrls.length <= 1) return
    onChange({ ...value, finalUrls: value.finalUrls.filter((_, i) => i !== idx) })
  }

  const inputCls =
    'flex-1 rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm focus:outline-none focus:border-[color-mix(in_srgb,var(--sc-accent)_60%,transparent)] disabled:opacity-50'
  const btnAdd =
    'text-xs text-[var(--sc-accent)] border border-[color-mix(in_srgb,var(--sc-accent)_40%,transparent)] rounded px-2 py-1 hover:bg-[color-mix(in_srgb,var(--sc-accent)_10%,transparent)] disabled:opacity-40 disabled:cursor-not-allowed'
  const btnRemove =
    'ml-2 text-xs text-white/30 hover:text-[var(--st-danger)] disabled:opacity-30 disabled:cursor-not-allowed'

  return (
    <div className="space-y-6">
      {/* Headlines */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">
            Headlines{' '}
            <span className="text-white/40 text-xs font-normal">(3–15, max 30 chars each)</span>
          </h3>
          <button
            type="button"
            className={btnAdd}
            onClick={addHeadline}
            disabled={disabled || value.headlines.length >= 15}
            aria-label="Add headline"
          >
            + Add headline
          </button>
        </div>
        <div className="space-y-2">
          {value.headlines.map((h, idx) => (
            <div key={idx} className="flex items-center">
              <input
                type="text"
                className={inputCls}
                value={h.text}
                maxLength={35}
                onChange={(e) => patchHeadline(idx, e.target.value)}
                disabled={disabled}
                placeholder={`Headline ${idx + 1}`}
                aria-label={`Headline ${idx + 1}`}
              />
              <CharCounter len={h.text.length} max={30} />
              <button
                type="button"
                className={btnRemove}
                onClick={() => removeHeadline(idx)}
                disabled={disabled || value.headlines.length <= 3}
                aria-label={`Remove headline ${idx + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Descriptions */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">
            Descriptions{' '}
            <span className="text-white/40 text-xs font-normal">(2–4, max 90 chars each)</span>
          </h3>
          <button
            type="button"
            className={btnAdd}
            onClick={addDescription}
            disabled={disabled || value.descriptions.length >= 4}
            aria-label="Add description"
          >
            + Add description
          </button>
        </div>
        <div className="space-y-2">
          {value.descriptions.map((d, idx) => (
            <div key={idx} className="flex items-center">
              <input
                type="text"
                className={inputCls}
                value={d.text}
                maxLength={95}
                onChange={(e) => patchDescription(idx, e.target.value)}
                disabled={disabled}
                placeholder={`Description ${idx + 1}`}
                aria-label={`Description ${idx + 1}`}
              />
              <CharCounter len={d.text.length} max={90} />
              <button
                type="button"
                className={btnRemove}
                onClick={() => removeDescription(idx)}
                disabled={disabled || value.descriptions.length <= 2}
                aria-label={`Remove description ${idx + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Display URL paths */}
      <section>
        <h3 className="text-sm font-medium mb-2">
          Display URL paths{' '}
          <span className="text-white/40 text-xs font-normal">(optional, max 15 chars each)</span>
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center">
            <input
              type="text"
              className={inputCls}
              value={value.path1 ?? ''}
              maxLength={18}
              onChange={(e) => onChange({ ...value, path1: e.target.value || undefined })}
              disabled={disabled}
              placeholder="path1"
              aria-label="Display URL path 1"
            />
            <CharCounter len={(value.path1 ?? '').length} max={15} />
          </div>
          <div className="flex items-center">
            <input
              type="text"
              className={inputCls}
              value={value.path2 ?? ''}
              maxLength={18}
              onChange={(e) => onChange({ ...value, path2: e.target.value || undefined })}
              disabled={disabled}
              placeholder="path2"
              aria-label="Display URL path 2"
            />
            <CharCounter len={(value.path2 ?? '').length} max={15} />
          </div>
        </div>
      </section>

      {/* Final URLs */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">
            Landing URLs{' '}
            <span className="text-white/40 text-xs font-normal">(at least one required)</span>
          </h3>
          <button
            type="button"
            className={btnAdd}
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
                aria-label={`Final URL ${idx + 1}`}
              />
              <button
                type="button"
                className={btnRemove}
                onClick={() => removeUrl(idx)}
                disabled={disabled || value.finalUrls.length <= 1}
                aria-label={`Remove URL ${idx + 1}`}
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
