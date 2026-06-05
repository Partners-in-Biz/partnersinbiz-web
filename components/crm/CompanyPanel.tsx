'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { companyAccountOwnerRef } from '@/lib/companies/ownership'
import type { Company } from '@/lib/companies/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function labelize(value?: string): string | null {
  if (!value) return null
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) => (
      index === 0
        ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        : part.toLowerCase()
    ))
    .join('-')
}

function extractCompanyRecord(body: unknown): Company | null {
  if (!body || typeof body !== 'object') return null
  const payload = body as { data?: unknown; company?: Company }
  if (payload.data && typeof payload.data === 'object') {
    const data = payload.data as Company | { company?: Company }
    if ('company' in data) return data.company ?? null
    return data as Company
  }
  return payload.company ?? null
}

function openCompanyCardLabel(companyName: string): string {
  return `Open linked company ${companyName} from company card`
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CompanyPanelProps {
  companyId?: string
  companyName?: string
  companyHref?: string
  companyApiPath?: string
  emptyAction?: {
    label: string
    ariaLabel: string
    icon?: string
    onClick: () => void
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyPanel({ companyId, companyName, companyHref, companyApiPath, emptyAction }: CompanyPanelProps) {
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    // Keep the known company name actionable while the richer profile resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch(companyApiPath ?? `/api/v1/crm/companies/${companyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return
        const data = extractCompanyRecord(body)
        setCompany(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [companyApiPath, companyId])

  const resolvedCompanyHref = companyHref ?? (companyId ? `/portal/companies/${companyId}` : '')

  // Neither set
  if (!companyId && !companyName) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-pib-line)] bg-white/[0.015] p-3">
        <p className="text-sm text-[var(--color-pib-text-muted)]">No company linked</p>
        {emptyAction && (
          <button
            type="button"
            aria-label={emptyAction.ariaLabel}
            onClick={emptyAction.onClick}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
          >
            {emptyAction.icon && (
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{emptyAction.icon}</span>
            )}
            {emptyAction.label}
          </button>
        )}
      </div>
    )
  }

  // companyName only (hybrid fallback)
  if (!companyId && companyName) {
    return (
      <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.015] p-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">domain</span>
          <p className="text-sm text-[var(--color-pib-text)]">{companyName}</p>
        </div>
        {emptyAction && (
          <button
            type="button"
            aria-label={emptyAction.ariaLabel}
            onClick={emptyAction.onClick}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
          >
            {emptyAction.icon && (
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{emptyAction.icon}</span>
            )}
            {emptyAction.label}
          </button>
        )}
      </div>
    )
  }

  // companyId set — loading state
  if (loading) {
    const displayName = companyName?.trim() || 'Resolving company identity...'
    return (
      <div className="pib-card p-3 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center text-xs font-label text-on-surface-variant shrink-0">
          {initials(displayName)}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium leading-snug text-[var(--color-pib-text)] break-words">{displayName}</p>
          <p className="text-[11px] text-[var(--color-pib-text-muted)]">Resolving company profile...</p>
        </div>
        {companyId && (
          <Link
            href={resolvedCompanyHref}
            aria-label={openCompanyCardLabel(displayName)}
            className="text-xs text-[var(--color-accent-v2)] hover:underline shrink-0 flex items-center gap-0.5"
          >
            Open
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
          </Link>
        )}
      </div>
    )
  }

  // Full company card
  const displayName = company?.name?.trim() || companyName?.trim() || 'Company identity missing'
  const am = company ? companyAccountOwnerRef(company) : undefined
  const accountManagerLabel = am?.displayName?.trim() || (am?.uid ? 'Account manager identity missing' : '')
  const lifecycle = labelize(company?.lifecycleStage)
  const tier = labelize(company?.tier)
  const health = typeof company?.healthScore === 'number' ? `Health ${company.healthScore}%` : null
  const signals = [lifecycle, tier, health].filter(Boolean)

  return (
    <div className="pib-card p-3 flex items-start gap-3">
      {company?.logoUrl ? (
        <Image
          src={company.logoUrl}
          alt={displayName}
          width={40}
          height={40}
          className="w-10 h-10 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center text-xs font-label text-on-surface-variant shrink-0">
          {initials(displayName)}
        </div>
      )}

      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm font-medium leading-snug text-[var(--color-pib-text)] break-words">{displayName}</p>
        {accountManagerLabel && (
          <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{accountManagerLabel}</p>
        )}
        {signals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {signals.map((signal) => (
              <span
                key={signal}
                className="rounded-full border border-[var(--color-pib-line)] bg-white/[0.03] px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]"
              >
                {signal}
              </span>
            ))}
          </div>
        )}
      </div>

      {companyId && (
        <Link
          href={resolvedCompanyHref}
          aria-label={openCompanyCardLabel(displayName)}
          className="text-xs text-[var(--color-accent-v2)] hover:underline shrink-0 flex items-center gap-0.5"
        >
          Open
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
        </Link>
      )}
    </div>
  )
}
