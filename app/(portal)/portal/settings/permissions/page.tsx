// app/(portal)/portal/settings/permissions/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Permissions {
  membersCanDeleteContacts: boolean
  membersCanExportContacts: boolean
  membersCanSendCampaigns: boolean
}

const DEFAULT_PERMISSIONS: Permissions = {
  membersCanDeleteContacts: false,
  membersCanExportContacts: false,
  membersCanSendCampaigns: true,
}

const TOGGLES: { key: keyof Permissions; label: string; description: string; risk: string; icon: string }[] = [
  {
    key: 'membersCanDeleteContacts',
    label: 'Members can delete contacts',
    description: 'Allow members to permanently delete CRM contacts.',
    risk: 'Contact deletion changes the shared customer record for every employee.',
    icon: 'delete',
  },
  {
    key: 'membersCanExportContacts',
    label: 'Members can export contacts',
    description: 'Allow members to export contact lists as CSV.',
    risk: 'Exports move relationship data outside the CRM audit trail.',
    icon: 'download',
  },
  {
    key: 'membersCanSendCampaigns',
    label: 'Members can create and send campaigns',
    description: 'Allow members to build and send marketing campaigns.',
    risk: 'Campaign sends can reach customers before leadership review.',
    icon: 'campaign',
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
  { label: 'Admins have full access (except changing roles)', description: 'Fixed - cannot be restricted.' },
  { label: 'Owners always have full access', description: 'Fixed - cannot be restricted.' },
  { label: 'Viewers are read-only', description: 'Fixed - viewers can never edit or delete.' },
]

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]" aria-hidden="true">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMISSIONS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<keyof Permissions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadPermissions = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    fetch('/api/v1/portal/settings/permissions')
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : `Failed to load permissions (${response.status})`)
        }
        return body
      })
      .then((body) => {
        if (body?.permissions) setPermissions(body.permissions)
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Permission settings could not load.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  const elevatedControls = useMemo(
    () => TOGGLES.filter((toggle) => permissions[toggle.key]).length,
    [permissions],
  )
  const restrictedControls = TOGGLES.length - elevatedControls
  const riskiestEnabled = TOGGLES.find((toggle) => permissions[toggle.key])

  async function handleTogglePermission(key: keyof Permissions) {
    const previousValue = permissions[key]
    const newValue = !previousValue
    setSaving(key)
    setSaveError(null)
    setPermissions((current) => ({ ...current, [key]: newValue }))
    try {
      const response = await fetch('/api/v1/portal/settings/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newValue }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(typeof body?.error === 'string' ? body.error : `Failed to save permission (${response.status})`)
      }
    } catch (err) {
      setPermissions((current) => ({ ...current, [key]: previousValue }))
      setSaveError(err instanceof Error ? err.message : 'Permission change was not saved.')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading CRM permissions">
        <p className="eyebrow">CRM settings</p>
        <div className="h-8 w-44 rounded bg-white/10" />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="h-24 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" />
          <div className="h-24 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" />
          <div className="h-24 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" />
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <header>
          <p className="eyebrow">CRM settings</p>
          <h1 className="pib-page-title mt-2">Permissions</h1>
          <p className="pib-page-sub mt-2 max-w-2xl">
            Control what members can do in this workspace.
          </p>
        </header>
        <section role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-5">
          <p className="eyebrow !text-[10px] text-amber-100">Permission source</p>
          <h2 className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Permissions could not load</h2>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{loadError}</p>
          <button type="button" onClick={loadPermissions} className="btn-pib-secondary mt-4 text-sm">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
            Retry loading permissions
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">CRM settings</p>
        <h1 className="pib-page-title mt-2">Permissions</h1>
        <p className="pib-page-sub mt-2 max-w-2xl">
          Set the CRM guardrails for member deletion, exports, and campaign sends before work scales across the team.
        </p>
      </header>

      <section role="region" aria-label="CRM permission guardrails" className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow !text-[10px]">Executive guardrails</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">CRM permission guardrails</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Review which member actions can change CRM data, move customer lists, or send campaigns without owner intervention.
            </p>
          </div>
          {riskiestEnabled && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              {riskiestEnabled.risk}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <StatCard label="Elevated access" value={`${elevatedControls} elevated controls`} sub="Member actions currently allowed." icon="admin_panel_settings" />
          <StatCard label="Restrictions" value={`${restrictedControls} restricted`} sub="Member actions held behind leadership." icon="block" />
          <StatCard label="Fixed safeguards" value={`${FIXED_ROWS.length} fixed safeguards`} sub="Owner, admin, and viewer rules." icon="verified_user" />
        </div>
      </section>

      {saveError && (
        <div role="status" aria-label="CRM permission save failed" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4">
          <p className="text-sm font-medium text-amber-100">{saveError}</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            The permission was rolled back so the visible CRM guardrail still matches the saved workspace policy.
          </p>
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" aria-label="Member permission toggles">
        <div className="border-b border-[var(--color-pib-line)] px-5 py-3">
          <p className="eyebrow !text-[10px]">Member toggles</p>
        </div>
        {TOGGLES.map((item) => (
          <div key={item.key} className="flex items-center gap-4 border-b border-[var(--color-pib-line)] px-5 py-4 last:border-0">
            <span className="material-symbols-outlined hidden text-[18px] text-[var(--color-pib-accent)] sm:inline" aria-hidden="true">{item.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--color-pib-text)]">{item.label}</p>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{item.description}</p>
            </div>
            <button
              type="button"
              onClick={() => handleTogglePermission(item.key)}
              disabled={saving === item.key}
              aria-label={permissionActionLabel(item.key, permissions[item.key])}
              aria-pressed={permissions[item.key]}
              className={[
                'relative h-5 w-10 shrink-0 rounded-full transition-colors',
                permissions[item.key] ? 'bg-[var(--color-pib-accent)]' : 'bg-[var(--color-pib-line-strong)]',
                saving === item.key ? 'cursor-wait opacity-60' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                  permissions[item.key] ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" aria-label="Fixed permission safeguards">
        <div className="border-b border-[var(--color-pib-line)] px-5 py-3">
          <p className="eyebrow !text-[10px]">Fixed behaviours</p>
        </div>
        {FIXED_ROWS.map((row) => (
          <div key={row.label} className="flex items-center gap-4 border-b border-[var(--color-pib-line)] px-5 py-4 last:border-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--color-pib-text)]">{row.label}</p>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{row.description}</p>
            </div>
            <span className="material-symbols-outlined shrink-0 text-[18px] text-[var(--color-pib-text-muted)]" aria-hidden="true">lock</span>
          </div>
        ))}
      </section>
    </div>
  )
}
