'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface OrgSummary {
  id: string
  name: string
  slug: string
  type: string
  status: string
  description?: string
  logoUrl?: string
  memberCount: number
  createdAt?: unknown
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active:      { label: 'Active',      color: '#4ade80' },
    onboarding:  { label: 'Onboarding',  color: 'var(--color-accent-v2)' },
    suspended:   { label: 'Suspended',   color: 'var(--color-error)' },
    churned:     { label: 'Churned',     color: 'var(--color-outline)' },
  }
  const s = map[status] ?? { label: status, color: 'var(--color-outline)' }
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${s.color}20`, color: s.color }}
    >
      {s.label}
    </span>
  )
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => {
        // Filter to client orgs only (exclude platform_owner)
        const clients = (body.data ?? []).filter((o: OrgSummary) => o.type !== 'platform_owner')
        setOrgs(clients)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = orgs.filter(o =>
    !search || o.name.toLowerCase().includes(search.toLowerCase())
  )

  const activeCount = orgs.filter(o => o.status === 'active').length

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Organisations</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            {loading ? '—' : `${activeCount} active of ${orgs.length} total`}
          </p>
        </div>
        <Link href="/admin/organizations/new" className="pib-btn-primary text-sm font-label">+ New Client</Link>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search organisations..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2.5 text-sm bg-[var(--color-card)] border border-[var(--color-card-border)] rounded-[var(--radius-btn)] text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)] transition-colors"
      />

      {/* Table */}
      <div className="pib-card overflow-hidden !p-0">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-card-border)]">
          <p className="col-span-5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Name</p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Status</p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant text-center sm:text-left">Members</p>
          <p className="col-span-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Actions</p>
        </div>

        {/* Rows */}
        {loading ? (
          <div className="divide-y divide-[var(--color-card-border)]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <Skeleton className="h-5 w-48" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-on-surface-variant text-sm">No organisations found.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-card-border)]">
            {filtered.map(org => (
              <div
                key={org.id}
                className="grid grid-cols-12 gap-4 items-center px-5 py-3.5 hover:bg-[var(--color-row-hover)] transition-colors"
              >
                {/* Name + description */}
                <div className="col-span-5 min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">{org.name}</p>
                  {org.description && (
                    <p className="text-xs text-on-surface-variant truncate mt-0.5">{org.description}</p>
                  )}
                </div>
                {/* Status */}
                <div className="col-span-2">
                  <StatusBadge status={org.status} />
                </div>
                {/* Members */}
                <div className="col-span-2 flex justify-center sm:justify-start">
                  <p className="text-sm text-on-surface-variant text-center sm:text-left">
                    <span className="sm:hidden">{org.memberCount}</span>
                    <span className="hidden sm:inline">{org.memberCount} member{org.memberCount !== 1 ? 's' : ''}</span>
                  </p>
                </div>
                {/* Actions */}
                <div className="col-span-3 flex gap-2">
                  <Link
                    href={`/admin/org/${org.slug}/dashboard`}
                    className="pib-btn-secondary text-xs font-label !px-2 sm:!px-4"
                    title="Open"
                  >
                    <span className="sm:hidden">↗</span>
                    <span className="hidden sm:inline">Open</span>
                  </Link>
                  <Link
                    href={`/admin/organizations/${org.id}`}
                    className="pib-btn-secondary text-xs font-label !px-2 sm:!px-4"
                    title="Edit"
                  >
                    <span className="sm:hidden">✎</span>
                    <span className="hidden sm:inline">Edit</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
