// app/(portal)/portal/settings/permissions/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

// ---- Role x feature matrix (US-198) ----

const FEATURE_KEYS = ['crm', 'social', 'email', 'seo', 'analytics', 'billing', 'documents', 'settings'] as const
type FeatureKey = (typeof FEATURE_KEYS)[number]

const MATRIX_ROLES = ['admin', 'member', 'viewer'] as const
type MatrixRole = (typeof MATRIX_ROLES)[number]

type RoleMatrix = Record<MatrixRole, Record<FeatureKey, boolean>>

const FEATURE_LABELS: Record<FeatureKey, { label: string; icon: string; description: string }> = {
  crm: { label: 'CRM', icon: 'contacts', description: 'Contacts, leads, deals, and pipeline.' },
  social: { label: 'Social', icon: 'share', description: 'Social posts, scheduling, and analytics.' },
  email: { label: 'Email', icon: 'mail', description: 'Email and SMS outreach campaigns.' },
  seo: { label: 'SEO', icon: 'travel_explore', description: 'SEO sprints, keywords, and audits.' },
  analytics: { label: 'Analytics', icon: 'analytics', description: 'Product analytics and reports.' },
  billing: { label: 'Billing', icon: 'payments', description: 'Invoices, quotes, and finance.' },
  documents: { label: 'Documents', icon: 'description', description: 'Proposals, specs, and client docs.' },
  settings: { label: 'Settings', icon: 'settings', description: 'Workspace settings and configuration.' },
}

const ROLE_LABELS: Record<MatrixRole, { label: string; description: string }> = {
  admin: { label: 'Admin', description: 'Manages the workspace and team.' },
  member: { label: 'Editor', description: 'Creates and edits operational work.' },
  viewer: { label: 'Viewer', description: 'Read-only visibility into features.' },
}

function emptyMatrix(): RoleMatrix {
  const blankRow = () => FEATURE_KEYS.reduce((acc, k) => { acc[k] = false; return acc }, {} as Record<FeatureKey, boolean>)
  return { admin: blankRow(), member: blankRow(), viewer: blankRow() }
}

// ---- Advanced guardrails (existing 3-toggle permissions API) ----

interface Guardrails {
  membersCanDeleteContacts: boolean
  membersCanExportContacts: boolean
  membersCanSendCampaigns: boolean
}

const DEFAULT_GUARDRAILS: Guardrails = {
  membersCanDeleteContacts: false,
  membersCanExportContacts: false,
  membersCanSendCampaigns: true,
}

const GUARDRAILS: { key: keyof Guardrails; label: string; description: string; icon: string }[] = [
  {
    key: 'membersCanDeleteContacts',
    label: 'Members can delete contacts',
    description: 'Allow members to permanently delete CRM contacts.',
    icon: 'delete',
  },
  {
    key: 'membersCanExportContacts',
    label: 'Members can export contacts',
    description: 'Allow members to export contact lists as CSV.',
    icon: 'download',
  },
  {
    key: 'membersCanSendCampaigns',
    label: 'Members can create and send campaigns',
    description: 'Allow members to build and send marketing campaigns.',
    icon: 'campaign',
  },
]

function Toggle({
  on,
  disabled,
  busy,
  onClick,
  label,
}: {
  on: boolean
  disabled?: boolean
  busy?: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={label}
      aria-pressed={on}
      className={[
        'relative h-5 w-10 shrink-0 rounded-full transition-colors',
        on ? 'bg-[var(--color-pib-accent)]' : 'bg-[var(--color-pib-line-strong)]',
        busy ? 'cursor-wait opacity-60' : '',
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      <span
        className={[
          'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

export default function PermissionsPage() {
  const searchParams = useSearchParams()
  const rolesEndpoint = useMemo(
    () => scopedApiPath('/api/v1/org/roles', scopeFromSearchParams(searchParams)),
    [searchParams],
  )
  const guardrailsEndpoint = useMemo(
    () => scopedApiPath('/api/v1/portal/settings/permissions', scopeFromSearchParams(searchParams)),
    [searchParams],
  )

  // Matrix state
  const [matrix, setMatrix] = useState<RoleMatrix>(emptyMatrix)
  const [ownerRow, setOwnerRow] = useState<Record<FeatureKey, boolean>>(() =>
    FEATURE_KEYS.reduce((acc, k) => { acc[k] = true; return acc }, {} as Record<FeatureKey, boolean>),
  )
  const [matrixLoading, setMatrixLoading] = useState(true)
  const [matrixLoadError, setMatrixLoadError] = useState<string | null>(null)
  const [matrixSaving, setMatrixSaving] = useState(false)
  const [matrixSaved, setMatrixSaved] = useState(false)
  const [matrixSaveError, setMatrixSaveError] = useState<string | null>(null)

  // Guardrails state
  const [guardrails, setGuardrails] = useState<Guardrails>(DEFAULT_GUARDRAILS)
  const [guardrailSaving, setGuardrailSaving] = useState<keyof Guardrails | null>(null)
  const [guardrailError, setGuardrailError] = useState<string | null>(null)

  const loadMatrix = useCallback(() => {
    setMatrixLoading(true)
    setMatrixLoadError(null)
    fetch(rolesEndpoint)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Failed to load roles (${res.status})`)
        return body
      })
      .then((body) => {
        const payload = body?.data ?? body
        if (payload?.matrix) setMatrix(payload.matrix as RoleMatrix)
        if (payload?.owner) setOwnerRow(payload.owner as Record<FeatureKey, boolean>)
      })
      .catch((err) => setMatrixLoadError(err instanceof Error ? err.message : 'Role permissions could not load.'))
      .finally(() => setMatrixLoading(false))
  }, [rolesEndpoint])

  useEffect(() => {
    loadMatrix()
  }, [loadMatrix])

  useEffect(() => {
    fetch(guardrailsEndpoint)
      .then(async (res) => (res.ok ? res.json().catch(() => ({})) : {}))
      .then((body) => {
        const payload = body?.data ?? body
        if (payload?.permissions) setGuardrails(payload.permissions as Guardrails)
      })
      .catch(() => { /* guardrails are optional/best-effort */ })
  }, [guardrailsEndpoint])

  function toggleCell(role: MatrixRole, feature: FeatureKey) {
    setMatrix((current) => ({
      ...current,
      [role]: { ...current[role], [feature]: !current[role][feature] },
    }))
    setMatrixSaved(false)
    setMatrixSaveError(null)
  }

  async function saveMatrix() {
    setMatrixSaving(true)
    setMatrixSaved(false)
    setMatrixSaveError(null)
    try {
      const res = await fetch(rolesEndpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Failed to save roles (${res.status})`)
      const payload = body?.data ?? body
      if (payload?.matrix) setMatrix(payload.matrix as RoleMatrix)
      setMatrixSaved(true)
      setTimeout(() => setMatrixSaved(false), 3000)
    } catch (err) {
      setMatrixSaveError(err instanceof Error ? err.message : 'Role permissions were not saved.')
    } finally {
      setMatrixSaving(false)
    }
  }

  async function toggleGuardrail(key: keyof Guardrails) {
    const previous = guardrails[key]
    const next = !previous
    setGuardrailSaving(key)
    setGuardrailError(null)
    setGuardrails((current) => ({ ...current, [key]: next }))
    try {
      const res = await fetch(guardrailsEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body?.error === 'string' ? body.error : `Failed to save guardrail (${res.status})`)
      }
    } catch (err) {
      setGuardrails((current) => ({ ...current, [key]: previous }))
      setGuardrailError(err instanceof Error ? err.message : 'Guardrail change was not saved.')
    } finally {
      setGuardrailSaving(null)
    }
  }

  if (matrixLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading role permissions">
        <p className="eyebrow">Workspace settings</p>
        <div className="h-8 w-44 rounded bg-white/10" />
        <div className="h-48 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" />
      </div>
    )
  }

  if (matrixLoadError) {
    return (
      <div className="space-y-6">
        <header>
          <p className="eyebrow">Workspace settings</p>
          <h1 className="pib-page-title mt-2">Permissions</h1>
          <p className="pib-page-sub mt-2 max-w-2xl">Control which roles can access each feature.</p>
        </header>
        <section role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-5">
          <p className="eyebrow !text-[10px] text-amber-100">Permission source</p>
          <h2 className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Permissions could not load</h2>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{matrixLoadError}</p>
          <button type="button" onClick={loadMatrix} className="pib-btn-secondary mt-4 text-sm">
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
        <p className="eyebrow">Workspace settings</p>
        <h1 className="pib-page-title mt-2">Permissions</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Decide which roles can access each part of the platform. Owners always have full access; the matrix below
          governs Admins, Editors, and Viewers.
        </p>
      </header>

      {/* Role x feature matrix */}
      <section role="region" aria-label="Role and feature permission matrix" className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow !text-[10px]">Access control</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">Role &times; feature matrix</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Toggle whether each role can access a feature. Changes apply once you save.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {matrixSaved && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-pib-success,#22c55e)]/10 px-3 py-1 text-xs font-medium text-[var(--color-pib-success,#22c55e)]">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                Saved
              </span>
            )}
            <button type="button" onClick={saveMatrix} disabled={matrixSaving} className="pib-btn-primary disabled:opacity-60">
              {matrixSaving ? 'Saving...' : 'Save permissions'}
            </button>
          </div>
        </div>

        {matrixSaveError && (
          <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            {matrixSaveError}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                <th className="px-5 py-4">
                  <span className="eyebrow !text-[10px]">Feature</span>
                </th>
                <th className="px-4 py-4 text-center">
                  <span className="block text-sm font-medium text-[var(--color-pib-text-muted)]">Owner</span>
                  <span className="block text-[10px] text-[var(--color-pib-text-muted)]">All access</span>
                </th>
                {MATRIX_ROLES.map((role) => (
                  <th key={role} className="px-4 py-4 text-center">
                    <span className="block text-sm font-medium text-[var(--color-pib-text)]">{ROLE_LABELS[role].label}</span>
                    <span className="block text-[10px] text-[var(--color-pib-text-muted)]">{ROLE_LABELS[role].description}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_KEYS.map((feature) => (
                <tr key={feature} className="border-b border-[var(--color-pib-line)] last:border-0">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]" aria-hidden="true">
                        {FEATURE_LABELS[feature].icon}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-pib-text)]">{FEATURE_LABELS[feature].label}</p>
                        <p className="text-xs text-[var(--color-pib-text-muted)]">{FEATURE_LABELS[feature].description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className="material-symbols-outlined text-[18px] text-[var(--color-pib-success,#22c55e)]"
                      aria-label={`Owner always has access to ${FEATURE_LABELS[feature].label}`}
                      title="Owners always have full access"
                    >
                      {ownerRow[feature] ? 'lock' : 'lock_open'}
                    </span>
                  </td>
                  {MATRIX_ROLES.map((role) => (
                    <td key={role} className="px-4 py-4">
                      <div className="flex justify-center">
                        <Toggle
                          on={matrix[role][feature]}
                          busy={matrixSaving}
                          onClick={() => toggleCell(role, feature)}
                          label={`${matrix[role][feature] ? 'Remove' : 'Grant'} ${ROLE_LABELS[role].label} access to ${FEATURE_LABELS[feature].label}`}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Advanced guardrails — preserves the original 3-toggle CRM permissions API */}
      <section role="region" aria-label="Advanced CRM guardrails" className="space-y-4">
        <div className="max-w-2xl">
          <p className="eyebrow !text-[10px]">Advanced guardrails</p>
          <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">CRM action guardrails</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
            Fine-grained limits on high-risk member actions, beyond feature access. These save instantly.
          </p>
        </div>

        {guardrailError && (
          <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            {guardrailError}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]">
          {GUARDRAILS.map((item) => (
            <div key={item.key} className="flex items-center gap-4 border-b border-[var(--color-pib-line)] px-5 py-4 last:border-0">
              <span className="material-symbols-outlined hidden text-[18px] text-[var(--color-pib-accent)] sm:inline" aria-hidden="true">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-pib-text)]">{item.label}</p>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{item.description}</p>
              </div>
              <Toggle
                on={guardrails[item.key]}
                busy={guardrailSaving === item.key}
                onClick={() => toggleGuardrail(item.key)}
                label={`${guardrails[item.key] ? 'Disable' : 'Enable'} ${item.label}`}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
