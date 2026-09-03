'use client'

import { useEffect, useState } from 'react'
import { Surface, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet, formatDateTime } from './OrgDetailApi'

import { Icon } from '@/components/studio'

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

  if (loading) return <Surface className="text-[var(--color-pib-text-muted)] text-sm">Loading activity…</Surface>
  if (error) return <Surface className="text-[var(--st-danger)] text-sm">{error}</Surface>

  return (
    <Surface header={<span className="font-label">Admin activity log</span>}>
      {entries.length === 0 ? (
        <EmptyState icon="history" title="No activity yet" description="Privileged admin actions on this org will appear here." />
      ) : (
        <ol className="space-y-0">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 border-b border-white/5 py-3 last:border-0">
              <span aria-hidden="true" className="mt-0.5">
                <Icon name={ACTION_ICON[e.action] ?? 'bolt'} className="text-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--color-pib-text)]">{e.summary || e.action}</p>
                <p className="text-xs text-[var(--color-pib-text-muted)]">
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
