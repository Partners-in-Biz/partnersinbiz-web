'use client'

import { useEffect, useState } from 'react'
import { Surface, StatusPill, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet } from './OrgDetailApi'

interface Member {
  uid: string
  role: string
  jobTitle: string | null
  department: string | null
  isOwner: boolean
  email: string
  displayName: string
  lastSignInTime: string | null
}

const ROLE_TONE: Record<string, 'accent' | 'info' | 'neutral'> = {
  owner: 'accent', admin: 'info', member: 'neutral', viewer: 'neutral',
}

export function OrgTeamPanel({ slug }: { slug: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<{ members: Member[] }>(`/api/v1/admin/org/${slug}/team`)
      .then((d) => { if (!cancelled) { setMembers(d.members || []); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [slug])

  if (loading) return <Surface className="text-on-surface-variant text-sm">Loading team…</Surface>
  if (error) return <Surface className="text-red-400 text-sm">{error}</Surface>

  return (
    <Surface header={<span className="font-label">Team members ({members.length})</span>}>
      {members.length === 0 ? (
        <EmptyState icon="group" title="No members" description="This organisation has no members." />
      ) : (
        <div className="divide-y divide-white/5">
          {members.map((m) => (
            <div key={m.uid} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-on-surface truncate">
                  {m.displayName || m.email || m.uid}
                  {m.isOwner && <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--color-pib-accent)]">Owner</span>}
                </p>
                <p className="text-xs text-on-surface-variant truncate">
                  {m.email || '—'}{m.jobTitle ? ` · ${m.jobTitle}` : ''}
                </p>
              </div>
              <StatusPill tone={ROLE_TONE[m.role] ?? 'neutral'}>{m.role}</StatusPill>
            </div>
          ))}
        </div>
      )}
    </Surface>
  )
}
