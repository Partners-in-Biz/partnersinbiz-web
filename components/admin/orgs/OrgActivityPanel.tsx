'use client'

import { useEffect, useState } from 'react'
import { Surface, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet, formatDateTime } from './OrgDetailApi'

interface AuditEntry {
  id: string
  action: string
  summary: string
  actorUid: string
  actorRole: string
  createdAt: string | null
}

const ACTION_ICON: Record<string, string> = {
  'org.suspend': 'block',
  'org.unsuspend': 'check_circle',
  'org.delete': 'delete',
  'org.dev_mode': 'developer_mode',
  'org.feature_flags': 'flag',
  'org.message': 'mail',
  'org.reset_owner_password': 'lock_reset',
  'org.analytics_export': 'download',
}

export function OrgActivityPanel({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<{ entries: AuditEntry[] }>(`/api/v1/admin/org/${slug}/activity`)
      .then((d) => { if (!cancelled) { setEntries(d.entries || []); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [slug])

  if (loading) return <Surface className="text-on-surface-variant text-sm">Loading activity…</Surface>
  if (error) return <Surface className="text-red-400 text-sm">{error}</Surface>

  return (
    <Surface header={<span className="font-label">Admin activity log</span>}>
      {entries.length === 0 ? (
        <EmptyState icon="history" title="No activity yet" description="Privileged admin actions on this org will appear here." />
      ) : (
        <ol className="space-y-0">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 border-b border-white/5 py-3 last:border-0">
              <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-pib-accent)]">
                {ACTION_ICON[e.action] ?? 'bolt'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-on-surface">{e.summary || e.action}</p>
                <p className="text-xs text-on-surface-variant">
                  {e.action} · {e.actorRole} · {formatDateTime(e.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Surface>
  )
}
