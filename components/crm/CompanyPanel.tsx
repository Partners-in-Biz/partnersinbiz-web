'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
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

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CompanyPanelProps {
  companyId?: string
  companyName?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyPanel({ companyId, companyName }: CompanyPanelProps) {
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    // Existing async fetch pattern: show a compact skeleton while the linked company resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch(`/api/v1/crm/companies/${companyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return
        const data: Company | null = body?.data ?? null
        setCompany(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [companyId])

  // Neither set
  if (!companyId && !companyName) {
    return (
      <p className="text-sm text-[var(--color-pib-text-muted)]">No company linked</p>
    )
  }

  // companyName only (hybrid fallback)
  if (!companyId && companyName) {
    return (
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">domain</span>
        <p className="text-sm text-[var(--color-pib-text)]">{companyName}</p>
      </div>
    )
  }

  // companyId set — loading state
  if (loading) {
    return <div className="pib-skeleton h-12 w-full rounded-lg" />
  }

  // Full company card
  const displayName = company?.name ?? companyName ?? 'Unknown company'
  const am = company?.accountManagerRef
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
        <p className="text-sm font-medium text-[var(--color-pib-text)] truncate">{displayName}</p>
        {am && (
          <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{am.displayName}</p>
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
          href={`/portal/companies/${companyId}`}
          aria-label={`Open ${displayName}`}
          className="text-xs text-[var(--color-accent-v2)] hover:underline shrink-0 flex items-center gap-0.5"
        >
          Open
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
        </Link>
      )}
    </div>
  )
}
