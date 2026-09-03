'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import OrgsTable, { type AdminOrgRow } from '@/components/admin/orgs/OrgsTable'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Notice, Skeleton, Status } from '@/components/studio'

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
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        eyebrow="Admin · Clients"
        title="Client workspaces."
        description="Platform-admin operations for client organisations: billing, contacts, email activity, and provisioning."
        meta={
          loading ? (
            <span>-</span>
          ) : (
            <>
              <Status tone="success">{activeCount} active</Status>
              <span>{orgs.length} workspaces</span>
              <span className="st-num font-mono">R{Math.round(totalMrr).toLocaleString('en-ZA')} MRR</span>
            </>
          )
        }
        actions={(
          <Link href="/admin/organizations/new" className="st-btn st-btn--primary st-btn--sm shrink-0">
            Provision client workspace
          </Link>
        )}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {loading ? (
        <div className="st-panel overflow-hidden !p-0">
          <div className="divide-y divide-[var(--sc-line)]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <Skeleton height="1.25rem" width="12rem" />
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
