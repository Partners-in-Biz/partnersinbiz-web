'use client'

import { useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  ButtonLink,
  Notice,
  Panel,
  Skeleton,
  Status,
  Title,
} from '@/components/studio'
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
 * Aggregate Shared work hub - projected company_workspace records grouped by
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
          setError((companiesBody?.error as string) || 'Could not load shared work.')
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
        if (!cancelled) setError('Could not load shared work.')
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Partners"
        title="Shared work."
        description="Progress your partners are projecting into your organisation from their CRM company books."
        actions={<ButtonLink href="/portal/partners" variant="ghost" size="sm">Back to partners</ButtonLink>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton height="4rem" />
          <Skeleton height="8rem" />
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          title="Nothing shared with you yet."
          description="When a partner links their company to your organisation and enables modules, work appears here."
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(([servingOrgId, group]) => (
            <Panel key={servingOrgId}>
              <Title>From {group.servingOrgName}</Title>
              <div className="mt-4 space-y-4">
                {group.companies.map((company) => {
                  const moduleRecords = company.modules.flatMap((module) =>
                    (recordsByModule[module] ?? []).filter((r) => r.companyId === company.companyId),
                  )
                  return (
                    <div key={company.companyId} className="st-panel st-panel--flat p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h3 className="st-title text-[1rem]">{company.companyName}</h3>
                        <span className="sc-tiny text-[var(--sc-ink-soft)]">
                          {company.modules.join(' · ') || 'no modules'}
                        </span>
                      </div>
                      {moduleRecords.length === 0 ? (
                        <p className="sc-body text-[0.875rem]">No shared records yet for the enabled modules.</p>
                      ) : (
                        <ul className="space-y-2">
                          {moduleRecords.map((record) => (
                            <li key={`${record.module}:${record.id}`} className="sc-body flex flex-wrap items-center gap-2 text-[0.875rem]">
                              <Status>{record.module}</Status>
                              {String(record.fields.siteName || record.fields.name || record.fields.title || record.id)}
                              {record.fields.status ? (
                                <span className="sc-tiny text-[var(--sc-ink-soft)]">
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
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
