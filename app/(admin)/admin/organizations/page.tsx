'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import OrgsTable, { type AdminOrgRow } from '@/components/admin/orgs/OrgsTable'

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<AdminOrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/admin/dashboard/organizations')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (!body?.success) {
          setError(body?.error || 'Failed to load organisations')
          setLoading(false)
          return
        }
        const rows: AdminOrgRow[] = (body.data?.organizations ?? []) as AdminOrgRow[]
        setOrgs(rows)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('Failed to load organisations')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const activeCount = orgs.filter((o) => o.status === 'active').length
  const totalMrr = orgs.reduce((sum, o) => sum + (o.mrr || 0), 0)

  return (
    <div className="space-y-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Admin · Clients</p>
          <h1 className="pib-page-title mt-2">Client Workspaces</h1>
          <p className="pib-page-sub">
            Platform-admin operations for client organisations — billing, contacts, email activity, and provisioning.
          </p>
          <p className="text-xs text-[var(--color-pib-text-faint)] mt-2">
            {loading
              ? '—'
              : `${activeCount} active of ${orgs.length} client workspaces · R${Math.round(totalMrr).toLocaleString('en-ZA')} MRR`}
          </p>
        </div>
        <Link href="/admin/organizations/new" className="btn-pib-primary shrink-0">
          + Provision client workspace
        </Link>
      </header>

      {error ? (
        <div className="pib-card text-sm text-[var(--color-error)]">{error}</div>
      ) : null}

      {loading ? (
        <div className="pib-card overflow-hidden !p-0">
          <div className="divide-y divide-[var(--color-pib-line)]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <div className="pib-skeleton h-5 w-48" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <OrgsTable orgs={orgs} />
      )}
    </div>
  )
}
