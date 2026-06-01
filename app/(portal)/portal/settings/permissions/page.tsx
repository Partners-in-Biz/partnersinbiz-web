// app/(portal)/portal/settings/permissions/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'

interface Permissions {
  membersCanDeleteContacts: boolean
  membersCanExportContacts: boolean
  membersCanSendCampaigns: boolean
}

const TOGGLES: { key: keyof Permissions; label: string; description: string }[] = [
  {
    key: 'membersCanDeleteContacts',
    label: 'Members can delete contacts',
    description: 'Allow members to permanently delete CRM contacts.',
  },
  {
    key: 'membersCanExportContacts',
    label: 'Members can export contacts',
    description: 'Allow members to export contact lists as CSV.',
  },
  {
    key: 'membersCanSendCampaigns',
    label: 'Members can create and send campaigns',
    description: 'Allow members to build and send marketing campaigns.',
  },
]

function permissionActionLabel(key: keyof Permissions, enabled: boolean): string {
  if (key === 'membersCanDeleteContacts') {
    return enabled ? 'Stop members from deleting contacts' : 'Allow members to delete contacts'
  }
  if (key === 'membersCanExportContacts') {
    return enabled ? 'Stop members from exporting contacts' : 'Allow members to export contacts'
  }
  return enabled
    ? 'Stop members from creating and sending campaigns'
    : 'Allow members to create and send campaigns'
}

const FIXED_ROWS: { label: string; description: string }[] = [
  { label: 'Admins have full access (except changing roles)', description: 'Fixed — cannot be restricted.' },
  { label: 'Owners always have full access', description: 'Fixed — cannot be restricted.' },
  { label: 'Viewers are read-only', description: 'Fixed — viewers can never edit or delete.' },
]

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permissions>({
    membersCanDeleteContacts: false,
    membersCanExportContacts: false,
    membersCanSendCampaigns: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<keyof Permissions | null>(null)

  useEffect(() => {
    fetch('/api/v1/portal/settings/permissions')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.permissions) setPermissions(d.permissions) })
      .finally(() => setLoading(false))
  }, [])

  async function toggle(key: keyof Permissions) {
    const newValue = !permissions[key]
    setSaving(key)
    setPermissions(p => ({ ...p, [key]: newValue }))
    await fetch('/api/v1/portal/settings/permissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: newValue }),
    })
    setSaving(null)
  }

  if (loading) return <div className="text-sm text-[var(--color-pib-text-muted)]">Loading…</div>

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-semibold mb-1">Permissions</h1>
      <p className="text-sm text-[var(--color-pib-text-muted)] mb-8">
        Control what members can do in this workspace.
      </p>

      <div className="bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-[var(--color-pib-line)]">
          <p className="text-xs font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-widest">Member toggles</p>
        </div>
        {TOGGLES.map(t => (
          <div key={t.key} className="flex items-center gap-4 px-5 py-4 border-b border-[var(--color-pib-line)] last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{t.label}</p>
              <p className="text-xs text-[var(--color-pib-text-muted)]">{t.description}</p>
            </div>
            <button
              onClick={() => toggle(t.key)}
              disabled={saving === t.key}
              aria-label={permissionActionLabel(t.key, permissions[t.key])}
              aria-pressed={permissions[t.key]}
              className={[
                'relative w-10 h-5 rounded-full transition-colors shrink-0',
                permissions[t.key] ? 'bg-[var(--color-pib-accent)]' : 'bg-[var(--color-pib-line-strong)]',
                saving === t.key ? 'opacity-60' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  permissions[t.key] ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-pib-line)]">
          <p className="text-xs font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-widest">Fixed behaviours</p>
        </div>
        {FIXED_ROWS.map(r => (
          <div key={r.label} className="flex items-center gap-4 px-5 py-4 border-b border-[var(--color-pib-line)] last:border-0 opacity-50">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{r.label}</p>
              <p className="text-xs text-[var(--color-pib-text-muted)]">{r.description}</p>
            </div>
            <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)] shrink-0" aria-hidden="true">lock</span>
          </div>
        ))}
      </div>
    </div>
  )
}
