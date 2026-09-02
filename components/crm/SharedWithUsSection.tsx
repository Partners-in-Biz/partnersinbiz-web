'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type SharedRecord = {
  id: string
  servingOrgId: string
  companyId: string
  fields: Record<string, unknown>
}

type SharedWithUsSectionProps = {
  module: string
  companyId?: string
  hrefForRecord?: (record: SharedRecord) => string
  title?: string
  emptyLabel?: string
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

/**
 * Client-side “Shared with us” list for a module. Fetches projected serving-org
 * records for the active org.
 */
export function SharedWithUsSection({
  module,
  companyId,
  hrefForRecord,
  title = 'Shared with us',
  emptyLabel = 'No partner work is shared with you for this module yet.',
}: SharedWithUsSectionProps) {
  const [records, setRecords] = useState<SharedRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [servingNames, setServingNames] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const qs = new URLSearchParams({ module })
        if (companyId) qs.set('companyId', companyId)
        const res = await fetch(`/api/v1/company-work/shared?${qs.toString()}`)
        const body = unwrap(await res.json().catch(() => null))
        if (!res.ok || cancelled) return
        const list = (body?.records as SharedRecord[]) ?? []
        setRecords(list)

        const companiesRes = await fetch('/api/v1/company-work/shared')
        const companiesBody = unwrap(await companiesRes.json().catch(() => null))
        if (companiesRes.ok && !cancelled) {
          const map: Record<string, string> = {}
          for (const c of (companiesBody?.companies as Array<{ servingOrgId: string; servingOrgName: string }>) ?? []) {
            map[c.servingOrgId] = c.servingOrgName
          }
          setServingNames(map)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [module, companyId])

  if (loading) {
    return (
      <section className="mb-6 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-pib-text)]">{title}</h2>
        <p className="text-xs text-[var(--color-pib-text-muted)]">Loading shared work…</p>
      </section>
    )
  }

  if (records.length === 0) return null

  return (
    <section className="mb-6 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">{title}</h2>
      <ul className="space-y-2">
        {records.map((record) => {
          const name = String(record.fields.siteName || record.fields.name || record.fields.title || record.id)
          const by = servingNames[record.servingOrgId] || record.servingOrgId
          const href = hrefForRecord?.(record)
          const inner = (
            <>
              <span className="font-medium text-[var(--color-pib-text)]">{name}</span>
              <span className="ml-2 rounded-full bg-[var(--color-accent-v2)]/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                by {by}
              </span>
              {record.fields.status ? (
                <span className="ml-2 text-[11px] text-[var(--color-pib-text-muted)]">
                  {String(record.fields.status)}
                </span>
              ) : null}
            </>
          )
          return (
            <li key={`${record.servingOrgId}:${record.id}`} className="text-sm">
              {href ? (
                <Link href={href} className="hover:underline">{inner}</Link>
              ) : (
                <div>{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
      {records.length === 0 ? (
        <p className="text-xs text-[var(--color-pib-text-muted)]">{emptyLabel}</p>
      ) : null}
    </section>
  )
}
