'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface CompanySummary {
  id: string
  name: string
  logoUrl?: string
  openDealsCount?: number
}

export function TopCompaniesByPipelineTile() {
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/crm/companies?orderBy=updatedAt-desc&limit=5')
      .then((r) => r.json())
      .then((body) => {
        const data = body.data ?? body  // PiB apiSuccess envelope
        setCompanies(data.companies ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="pib-stat-card animate-pulse">
        <div className="h-4 w-32 bg-[var(--color-pib-line-strong)] rounded mb-3" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-[var(--color-pib-line-strong)] rounded" />
          ))}
        </div>
      </div>
    )
  }

  // Hide tile when org has no companies yet
  if (companies.length === 0) return null

  return (
    <div className="pib-stat-card">
      <div className="flex items-center justify-between mb-3">
        <p className="eyebrow !text-[10px]">Recent companies</p>
        <Link
          href="/portal/companies"
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
        >
          View all
          <span className="material-symbols-outlined text-sm">arrow_outward</span>
        </Link>
      </div>
      <ul className="space-y-1">
        {companies.map((c) => (
          <li key={c.id}>
            <Link
              href={`/portal/companies/${c.id}`}
              className="flex items-center gap-2.5 text-sm hover:bg-white/[0.03] p-1.5 rounded-lg transition-colors group"
            >
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" className="w-6 h-6 rounded object-contain shrink-0" />
              ) : (
                <div className="w-6 h-6 rounded bg-[var(--color-pib-line-strong)] shrink-0 flex items-center justify-center">
                  <span className="text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase leading-none">
                    {c.name[0] ?? '·'}
                  </span>
                </div>
              )}
              <span className="flex-1 truncate text-[var(--color-pib-text)] group-hover:text-[var(--color-pib-accent-hover)] transition-colors">
                {c.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {/* TODO Sub-program E3/B6: sort by pipeline value once deal aggregation lands */}
    </div>
  )
}
