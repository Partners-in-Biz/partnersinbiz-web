'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { COMPANY_WORKSPACE_MODULES } from '@/lib/company-work/module-keys'

type LinkedCompany = {
  companyId: string
  companyName: string
  servingOrgId: string
  servingOrgName: string
  partnerLinkId: string
  modules: string[]
}

type SharedRecord = {
  id: string
  module: string
  servingOrgId: string
  companyId: string
  fields: Record<string, unknown>
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

/**
 * Aggregate Shared work hub — projected company_workspace records grouped by
 * serving org and company.
 */
export default function SharedWorkHubPage() {
  const [companies, setCompanies] = useState<LinkedCompany[]>([])
  const [recordsByModule, setRecordsByModule] = useState<Record<string, SharedRecord[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const companiesRes = await fetch('/api/v1/company-work/shared')
        const companiesBody = unwrap(await companiesRes.json().catch(() => null))
        if (!companiesRes.ok) {
          setError((companiesBody?.error as string) || 'Could not load shared work')
          return
        }
        const list = (companiesBody?.companies as LinkedCompany[]) ?? []
        if (cancelled) return
        setCompanies(list)

        const modules = [...new Set(list.flatMap((c) => c.modules).filter((m) =>
          (COMPANY_WORKSPACE_MODULES as string[]).includes(m),
        ))]
        const settled = await Promise.all(modules.map(async (module) => {
          const res = await fetch(`/api/v1/company-work/shared?module=${encodeURIComponent(module)}`)
          const body = unwrap(await res.json().catch(() => null))
          return [module, res.ok ? ((body?.records as SharedRecord[]) ?? []) : []] as const
        }))
        if (cancelled) return
        setRecordsByModule(Object.fromEntries(settled))
      } catch {
        if (!cancelled) setError('Could not load shared work')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const grouped = useMemo(() => {
    const byServing = new Map<string, { servingOrgName: string; companies: LinkedCompany[] }>()
    for (const company of companies) {
      const key = company.servingOrgId
      const existing = byServing.get(key) ?? { servingOrgName: company.servingOrgName, companies: [] }
      existing.companies.push(company)
      byServing.set(key, existing)
    }
    return [...byServing.entries()]
  }, [companies])

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-2 text-xl font-semibold text-[var(--color-pib-text)]">Shared work</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Partners</p>
          <h1 className="text-xl font-semibold text-[var(--color-pib-text)]">Shared work</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
            Progress your partners are projecting into your organisation from their CRM company books.
          </p>
        </div>
        <Link href="/portal/partners" className="text-xs text-[var(--color-accent-v2)] hover:underline">
          Back to Partners
        </Link>
      </div>

      {error ? <p className="mb-4 text-sm text-rose-300">{error}</p> : null}

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-6 text-sm text-[var(--color-pib-text-muted)]">
          Nothing shared with you yet. When a partner links their company to your organisation and enables modules, work appears here.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([servingOrgId, group]) => (
            <section
              key={servingOrgId}
              className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4"
            >
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
                From {group.servingOrgName}
              </h2>
              <div className="space-y-4">
                {group.companies.map((company) => {
                  const moduleRecords = company.modules.flatMap((module) =>
                    (recordsByModule[module] ?? []).filter((r) => r.companyId === company.companyId),
                  )
                  return (
                    <div key={company.companyId} className="rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-[var(--color-pib-text)]">{company.companyName}</h3>
                        <span className="text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                          {company.modules.join(' · ') || 'no modules'}
                        </span>
                      </div>
                      {moduleRecords.length === 0 ? (
                        <p className="text-xs text-[var(--color-pib-text-muted)]">No shared records yet for the enabled modules.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {moduleRecords.map((record) => (
                            <li key={`${record.module}:${record.id}`} className="text-sm text-[var(--color-pib-text)]">
                              <span className="mr-2 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-pib-text-muted)]">
                                {record.module}
                              </span>
                              {String(record.fields.siteName || record.fields.name || record.fields.title || record.id)}
                              {record.fields.status ? (
                                <span className="ml-2 text-[11px] text-[var(--color-pib-text-muted)]">
                                  {String(record.fields.status)}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
