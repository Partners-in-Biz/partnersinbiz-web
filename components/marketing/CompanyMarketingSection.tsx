'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { MarketingCompanyCard } from '@/lib/companies/marketing-projection'

export function CompanyMarketingSection({ scope }: { scope: PortalOrgRouteScope }) {
  const orgId = scope.orgId?.trim()
  const [companies, setCompanies] = useState<MarketingCompanyCard[] | null>(null)

  useEffect(() => {
    if (!orgId) {
      setCompanies([])
      return
    }
    let cancelled = false
    fetch(scopedApiPath('/api/v1/portal/marketing/companies', scope))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((body) => {
        if (cancelled) return
        const rows = Array.isArray(body.data?.companies) ? body.data.companies as MarketingCompanyCard[] : []
        setCompanies(rows)
      })
      .catch(() => {
        if (!cancelled) setCompanies([])
      })
    return () => {
      cancelled = true
    }
  }, [orgId, scope.orgId, scope.orgSlug])

  if (!orgId || companies === null || companies.length === 0) return null

  return (
    <section className="space-y-3" aria-label="Company marketing">
      <h2 className="text-sm font-label font-semibold uppercase tracking-widest text-[var(--color-pib-text-muted)]">
        Company marketing
      </h2>
      <p className="text-sm text-[var(--color-pib-text-muted)]">
        Linked CRM companies we manage marketing for. Each has its own campaigns, accounts, and brand.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {companies.map((company) => {
          const href = scopedPortalPath('/portal/marketing', {
            orgId: scope.orgId,
            orgSlug: scope.orgSlug,
            sourceCompanyId: company.id,
            sourceCompanyName: company.name,
          })
          return (
            <Link
              key={company.id}
              href={href}
              className="pib-card group flex min-h-[148px] flex-col justify-between p-5 transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.03]"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                    <span className="material-symbols-outlined text-[22px]">apartment</span>
                  </span>
                  <span className="pill !px-2 !py-0.5 !text-[10px] shrink-0">CRM</span>
                </div>
                <div>
                  <h3 className="font-display text-base leading-snug text-[var(--color-pib-text)]">{company.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
                    Open this company&apos;s campaigns, accounts, and brand. Not mixed with organisation marketing.
                  </p>
                </div>
              </div>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-label text-[var(--color-pib-accent)]">
                Open
                <span className="material-symbols-outlined text-sm transition-transform group-hover:translate-x-0.5">arrow_forward</span>
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
