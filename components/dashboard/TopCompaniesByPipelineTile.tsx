'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

import { Icon } from '@/components/studio'

interface CompanySummary {
  id: string
  name: string
  logoUrl?: string
  openDealsCount?: number
}

type TopCompaniesByPipelineTileProps = {
  orgScope?: PortalOrgRouteScope
}

export function TopCompaniesByPipelineTile({ orgScope = {} }: TopCompaniesByPipelineTileProps) {
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [loading, setLoading] = useState(true)
  const companiesPath = useMemo(
    () => scopedApiPath('/api/v1/crm/companies?orderBy=updatedAt-desc&limit=5', orgScope),
    [orgScope],
  )
  const companiesHref = useMemo(() => scopedPortalPath('/portal/companies', orgScope), [orgScope])

  useEffect(() => {
    fetch(companiesPath)
      .then((r) => r.json())
      .then((body) => {
        const data = body.data ?? body  // PiB apiSuccess envelope
        setCompanies(data.companies ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [companiesPath])

  if (loading) {
    return (
      <div className="pib-stat-card animate-pulse" data-module-accent="amber">
        <div className="mb-2 h-3.5 w-28 rounded bg-[var(--color-pib-line-strong)]" />
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-7 rounded bg-[var(--color-pib-line-strong)]" />
          ))}
        </div>
      </div>
    )
  }

  // Hide tile when org has no companies yet
  if (companies.length === 0) return null

  return (
    <div className="pib-stat-card" data-module-accent="amber">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="" aria-hidden="true">
            <Icon name="apartment" className="text-[15px]" />
          </span>
          <p className="eyebrow !text-[10px] mb-0">Recent companies</p>
        </div>
        <Link
          href={companiesHref}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
        >
          View all
          <Icon name="arrow_outward" className="text-sm" />
        </Link>
      </div>
      <ul className="space-y-0.5">
        {companies.map((c) => (
          <li key={c.id}>
            <Link
              href={scopedPortalPath(`/portal/companies/${c.id}`, orgScope)}
              className="group flex items-center gap-2 rounded-lg p-1.5 text-sm transition-colors hover:bg-white/[0.03]"
            >
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--color-pib-line-strong)]">
                  <span className="text-[10px] font-medium uppercase leading-none text-[var(--color-pib-text-muted)]">
                    {c.name[0] ?? '·'}
                  </span>
                </div>
              )}
              <span className="flex-1 truncate text-[var(--color-pib-text)] transition-colors group-hover:text-[var(--color-pib-accent-hover)]">
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
