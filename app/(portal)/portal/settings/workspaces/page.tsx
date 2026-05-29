// app/(portal)/portal/settings/workspaces/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface OrgItem {
  id: string
  name: string
  logoUrl: string
}

export default function WorkspacesPage() {
  const [orgs, setOrgs] = useState<OrgItem[]>([])
  const [activeOrgId, setActiveOrgId] = useState('')
  const [switching, setSwitching] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/portal/orgs')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d?.orgs)) setOrgs(d.orgs)
        if (d?.activeOrgId) setActiveOrgId(d.activeOrgId)
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleSwitch(orgId: string) {
    if (orgId === activeOrgId || switching) return
    setSwitching(orgId)
    await fetch('/api/v1/portal/active-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    setActiveOrgId(orgId)
    setSwitching('')
  }

  if (loading) return <div className="text-sm text-[var(--color-pib-text-muted)]">Loading…</div>

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-semibold mb-1">My workspaces</h1>
      <p className="text-sm text-[var(--color-pib-text-muted)] mb-8">All workspaces your account is linked to.</p>

      <div className="space-y-2">
        <Link
          href="/portal/personal/marketing"
          className="bg-[var(--color-pib-surface)] border border-[var(--color-pib-accent)]/45 rounded-xl px-5 py-4 flex items-center gap-4 transition-colors hover:border-[var(--color-pib-accent)]"
        >
          <div className="w-8 h-8 rounded-lg bg-[var(--color-pib-accent-soft)] flex items-center justify-center text-[var(--color-pib-accent-hover)] shrink-0">
            <span className="material-symbols-outlined text-[18px]">person</span>
          </div>
          <span className="flex-1">
            <span className="block text-sm font-medium">Personal workspace</span>
            <span className="mt-0.5 block text-xs text-[var(--color-pib-text-muted)]">Your own social accounts, drafts, and scheduled posts.</span>
          </span>
          <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">arrow_forward</span>
        </Link>

        {orgs.map(org => (
          <div
            key={org.id}
            className="bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-xl px-5 py-4 flex items-center gap-4"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--color-pib-accent-soft)] flex items-center justify-center text-sm font-bold text-[var(--color-pib-accent-hover)] shrink-0">
              {org.name[0]?.toUpperCase() ?? '·'}
            </div>
            <span className="flex-1 text-sm font-medium">{org.name}</span>
            {org.id === activeOrgId ? (
              <span className="text-xs text-[var(--color-pib-accent)] flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                Active
              </span>
            ) : (
              <button
                onClick={() => handleSwitch(org.id)}
                disabled={!!switching}
                className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] disabled:opacity-50 transition-colors"
              >
                {switching === org.id ? 'Switching…' : 'Switch →'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
