'use client'

// components/crm/IcpProfileEditor.tsx
// Controlled editor for IcpProfile — used on /portal/settings/scoring

import type { IcpProfile } from '@/lib/scoring/types'
import type { CompanySize, CompanyTier } from '@/lib/companies/types'

const SIZE_OPTIONS: CompanySize[] = ['1-10', '11-50', '51-200', '201-1000', '1000+']
const TIER_OPTIONS: CompanyTier[] = ['enterprise', 'mid-market', 'smb']

interface Props {
  value: IcpProfile
  onChange: (next: IcpProfile) => void
  disabled?: boolean
}

export function IcpProfileEditor({ value, onChange, disabled }: Props) {
  function patch(partial: Partial<IcpProfile>) {
    onChange({ ...value, ...partial })
  }

  // ── Industries ───────────────────────────────────────────────────────────────

  const industriesStr = (value.industries ?? []).join(', ')

  function handleIndustriesChange(raw: string) {
    const arr = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    patch({ industries: arr })
  }

  // ── Sizes ────────────────────────────────────────────────────────────────────

  function toggleSize(size: CompanySize) {
    const current = value.sizes ?? []
    const next = current.includes(size)
      ? current.filter(s => s !== size)
      : [...current, size]
    patch({ sizes: next })
  }

  // ── Tiers ────────────────────────────────────────────────────────────────────

  function toggleTier(tier: CompanyTier) {
    const current = value.tiers ?? []
    const next = current.includes(tier)
      ? current.filter(t => t !== tier)
      : [...current, tier]
    patch({ tiers: next })
  }

  // ── Regions ──────────────────────────────────────────────────────────────────

  function addRegion() {
    patch({ regions: [...(value.regions ?? []), { country: '', state: '' }] })
  }

  function removeRegion(idx: number) {
    const next = (value.regions ?? []).filter((_, i) => i !== idx)
    patch({ regions: next })
  }

  function patchRegion(idx: number, field: 'country' | 'state', val: string) {
    const next = (value.regions ?? []).map((r, i) =>
      i === idx ? { ...r, [field]: val } : r,
    )
    patch({ regions: next })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] disabled:opacity-50'

  return (
    <div className="space-y-5">

      {/* Industries */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Target industries
          <span className="ml-1 text-xs text-[var(--color-pib-text-muted)] font-normal">(comma-separated)</span>
        </label>
        <input
          type="text"
          value={industriesStr}
          onChange={e => handleIndustriesChange(e.target.value)}
          placeholder="e.g. SaaS, Fintech, Healthcare"
          disabled={disabled}
          className={inputCls}
        />
      </div>

      {/* Sizes */}
      <div>
        <label className="block text-sm font-medium mb-2">Company sizes</label>
        <div className="flex flex-wrap gap-2">
          {SIZE_OPTIONS.map(size => {
            const active = (value.sizes ?? []).includes(size)
            return (
              <button
                key={size}
                type="button"
                onClick={() => toggleSize(size)}
                disabled={disabled}
                aria-pressed={active}
                className={[
                  'px-3 py-1 rounded-full text-sm border cursor-pointer transition-colors disabled:opacity-50',
                  active
                    ? 'bg-[var(--color-pib-accent-soft)] border-[var(--color-pib-accent)] text-[var(--color-pib-accent-hover)] font-medium'
                    : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]',
                ].join(' ')}
              >
                {size}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tiers */}
      <div>
        <label className="block text-sm font-medium mb-2">Customer tiers</label>
        <div className="flex flex-wrap gap-2">
          {TIER_OPTIONS.map(tier => {
            const active = (value.tiers ?? []).includes(tier)
            return (
              <button
                key={tier}
                type="button"
                onClick={() => toggleTier(tier)}
                disabled={disabled}
                aria-pressed={active}
                className={[
                  'px-3 py-1 rounded-full text-sm border cursor-pointer transition-colors disabled:opacity-50 capitalize',
                  active
                    ? 'bg-[var(--color-pib-accent-soft)] border-[var(--color-pib-accent)] text-[var(--color-pib-accent-hover)] font-medium'
                    : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]',
                ].join(' ')}
              >
                {tier}
              </button>
            )
          })}
        </div>
      </div>

      {/* Regions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium">Target regions</label>
          {!disabled && (
            <button
              type="button"
              onClick={addRegion}
              className="cursor-pointer text-xs text-[var(--color-pib-accent-hover)] hover:underline flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
              Add region
            </button>
          )}
        </div>
        {(value.regions ?? []).length === 0 ? (
          <p className="text-xs text-[var(--color-pib-text-muted)]">No regions set — scores all countries equally.</p>
        ) : (
          <div className="space-y-2">
            {(value.regions ?? []).map((region, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={region.country ?? ''}
                  onChange={e => {
                    const v = e.target.value.slice(0, 3).toUpperCase()
                    patchRegion(idx, 'country', v)
                  }}
                  placeholder="ZA"
                  maxLength={3}
                  disabled={disabled}
                  aria-label="Country code"
                  className="w-20 px-2 py-1.5 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-center font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] disabled:opacity-50"
                />
                <input
                  type="text"
                  value={region.state ?? ''}
                  onChange={e => patchRegion(idx, 'state', e.target.value)}
                  placeholder="State / province (optional)"
                  disabled={disabled}
                  aria-label="State"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] disabled:opacity-50"
                />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeRegion(idx)}
                    aria-label="Remove region"
                    className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-red-400 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Employee count */}
      <div>
        <label className="block text-sm font-medium mb-2">Employee count range (optional)</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={value.minEmployeeCount ?? ''}
            onChange={e => patch({ minEmployeeCount: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Min"
            min={0}
            disabled={disabled}
            aria-label="Min employee count"
            className="w-32 px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] disabled:opacity-50"
          />
          <span className="text-sm text-[var(--color-pib-text-muted)]">–</span>
          <input
            type="number"
            value={value.maxEmployeeCount ?? ''}
            onChange={e => patch({ maxEmployeeCount: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Max"
            min={0}
            disabled={disabled}
            aria-label="Max employee count"
            className="w-32 px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] disabled:opacity-50"
          />
        </div>
      </div>

      {/* Annual revenue */}
      <div>
        <label className="block text-sm font-medium mb-2">Annual revenue range (optional)</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={value.minAnnualRevenue ?? ''}
            onChange={e => patch({ minAnnualRevenue: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Min ($)"
            min={0}
            disabled={disabled}
            aria-label="Min annual revenue"
            className="w-36 px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] disabled:opacity-50"
          />
          <span className="text-sm text-[var(--color-pib-text-muted)]">–</span>
          <input
            type="number"
            value={value.maxAnnualRevenue ?? ''}
            onChange={e => patch({ maxAnnualRevenue: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Max ($)"
            min={0}
            disabled={disabled}
            aria-label="Max annual revenue"
            className="w-36 px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] disabled:opacity-50"
          />
        </div>
      </div>

    </div>
  )
}
