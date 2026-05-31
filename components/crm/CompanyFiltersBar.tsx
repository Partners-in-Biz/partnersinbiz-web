'use client'

import { useEffect, useRef, useState } from 'react'
import type { CompanyListParams, CompanyLifecycleStage, CompanySize, CompanyTier } from '@/lib/companies/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompanyFiltersBarProps {
  value: CompanyListParams
  onChange: (params: CompanyListParams) => void
}

// ── Dropdown chip ─────────────────────────────────────────────────────────────

interface ChipProps {
  label: string
  active: boolean
  options: string[]
  selectedValue?: string
  formatOption?: (value: string) => string
  onSelect: (value: string | undefined) => void
}

function readableAccountLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

function FilterChip({ label, active, options, selectedValue, formatOption = (value) => value, onSelect }: ChipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selectedLabel = selectedValue ? formatOption(selectedValue) : undefined

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={selectedLabel ? `${label}: ${selectedLabel}` : label}
        className={`cursor-pointer text-xs font-label px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
          active
            ? 'border-[var(--color-accent-v2)] text-[var(--color-accent-v2)] bg-[color-mix(in_oklab,var(--color-accent-v2)_10%,transparent)]'
            : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:border-[var(--color-pib-text-muted)]'
        }`}
      >
        {label}
        {selectedLabel && (
          <span className="font-mono text-[10px] opacity-75">: {selectedLabel}</span>
        )}
        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[160px] pib-card rounded-lg overflow-hidden shadow-lg">
          <button
            type="button"
            onClick={() => { onSelect(undefined); setOpen(false) }}
            className="cursor-pointer w-full text-left text-xs px-3 py-2 text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] transition-colors"
          >
            All
          </button>
          {options.map((opt) => {
            const optionLabel = formatOption(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => { onSelect(opt); setOpen(false) }}
                className={`cursor-pointer w-full text-left text-xs px-3 py-2 hover:bg-white/[0.05] transition-colors ${
                  selectedValue === opt
                    ? 'text-[var(--color-accent-v2)]'
                    : 'text-[var(--color-pib-text)]'
                }`}
              >
                {optionLabel}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

const INDUSTRIES = ['SaaS', 'FinTech', 'Healthcare', 'Retail', 'Manufacturing', 'Education', 'Real Estate', 'Other']
const SIZES: CompanySize[] = ['1-10', '11-50', '51-200', '201-1000', '1000+']
const TIERS: CompanyTier[] = ['enterprise', 'mid-market', 'smb']
const LIFECYCLES: CompanyLifecycleStage[] = ['lead', 'prospect', 'customer', 'churned']

export function CompanyFiltersBar({ value, onChange }: CompanyFiltersBarProps) {
  const [search, setSearch] = useState(value.search ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearch(q: string) {
    setSearch(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange({ ...value, search: q || undefined })
    }, 300)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[var(--color-pib-text-muted)]">
          search
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search companies…"
          className="pib-input pl-8 text-sm !w-48"
        />
      </div>

      <FilterChip
        label="Industry"
        active={!!value.industry}
        options={INDUSTRIES}
        selectedValue={value.industry}
        onSelect={(v) => onChange({ ...value, industry: v })}
      />

      <FilterChip
        label="Size"
        active={!!value.size}
        options={SIZES}
        selectedValue={value.size}
        onSelect={(v) => onChange({ ...value, size: v as CompanySize | undefined })}
      />

      <FilterChip
        label="Tier"
        active={!!value.tier}
        options={TIERS}
        selectedValue={value.tier}
        formatOption={readableAccountLabel}
        onSelect={(v) => onChange({ ...value, tier: v as CompanyTier | undefined })}
      />

      <FilterChip
        label="Lifecycle"
        active={!!value.lifecycleStage}
        options={LIFECYCLES}
        selectedValue={value.lifecycleStage}
        formatOption={readableAccountLabel}
        onSelect={(v) => onChange({ ...value, lifecycleStage: v as CompanyLifecycleStage | undefined })}
      />

      {/* Clear all */}
      {(value.search || value.industry || value.size || value.tier || value.lifecycleStage || value.accountManagerUid) && (
        <button
          type="button"
          onClick={() => { setSearch(''); onChange({ orgId: value.orgId }) }}
          className="cursor-pointer text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
          Clear
        </button>
      )}
    </div>
  )
}
