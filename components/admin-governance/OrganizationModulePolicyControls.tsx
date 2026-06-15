'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ORGANIZATION_POLICY_ROLE_KEYS,
  resolveOrganizationModulePolicies,
  type OrganizationModulePolicy,
  type OrganizationModulePolicyKey,
  type OrganizationPolicyItem,
  type OrganizationPolicyRole,
  type OrganizationRoleSelection,
} from '@/lib/organizations/module-policies'
import type { PortalModuleKey } from '@/lib/organizations/portal-modules'

export type OrganizationPolicyActionRow = {
  id: string
  title: string
  description: string
}

export type OrganizationOwnerControlRow = {
  id: string
  label: string
}

type SaveState = 'idle' | 'dirty' | 'saved' | 'error'

type OrganizationSummary = {
  id: string
  slug?: string
  name?: string
}

type UseOrganizationModulePolicyArgs = {
  orgSlug: string
  moduleKey: OrganizationModulePolicyKey
}

const ROLE_LABELS: Record<OrganizationPolicyRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

const ALL_ROLES: OrganizationRoleSelection = { owner: true, admin: true, member: true }
const LEGACY_PORTAL_MODULE_KEYS: OrganizationModulePolicyKey[] = ['mobileApps', 'youtubeStudio', 'bookStudio']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function defaultPolicy(moduleKey: OrganizationModulePolicyKey): OrganizationModulePolicy {
  return resolveOrganizationModulePolicies(undefined)[moduleKey]
}

function isLegacyPortalModuleKey(moduleKey: OrganizationModulePolicyKey): moduleKey is PortalModuleKey {
  return LEGACY_PORTAL_MODULE_KEYS.includes(moduleKey)
}

function statusLabel(state: SaveState, loading: boolean, saving: boolean, error: string) {
  if (loading) return 'Loading saved settings...'
  if (saving) return 'Saving...'
  if (error) return error
  if (state === 'dirty') return 'Unsaved changes'
  if (state === 'saved') return 'Saved'
  return 'Loaded'
}

export function policyItemIdFromLabel(label: string, fallbackPrefix: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `${fallbackPrefix}-${Date.now()}`
}

export function ownerControlRows(labels: string[]): OrganizationOwnerControlRow[] {
  return labels.map((label) => ({ id: policyItemIdFromLabel(label, 'owner-control'), label }))
}

export function useOrganizationModulePolicy({ orgSlug, moduleKey }: UseOrganizationModulePolicyArgs) {
  const [orgId, setOrgId] = useState('')
  const [policy, setPolicy] = useState<OrganizationModulePolicy>(() => defaultPolicy(moduleKey))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (typeof fetch !== 'function') {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      try {
        const orgsRes = await fetch('/api/v1/organizations')
        const orgsBody = await orgsRes.json().catch(() => ({}))
        const orgs = Array.isArray(orgsBody.data) ? orgsBody.data as OrganizationSummary[] : []
        const org = orgs.find((item) => item.slug === orgSlug)
        if (!org?.id) throw new Error('Organisation not found')

        const headers = { 'X-Org-Id': org.id, 'X-Org-Slug': orgSlug }
        const detailRes = await fetch(`/api/v1/organizations/${encodeURIComponent(org.id)}`, { headers })
        const detailBody = await detailRes.json().catch(() => ({}))
        if (!detailRes.ok) throw new Error(detailBody.error || 'Could not load organisation settings')
        const detail = detailBody.data ?? detailBody.organization ?? detailBody.org
        const settings = isRecord(detail) ? detail.settings : undefined
        const nextPolicy = resolveOrganizationModulePolicies(settings)[moduleKey]

        if (!cancelled) {
          setOrgId(org.id)
          setPolicy(nextPolicy)
          setSaveState('idle')
        }
      } catch (err) {
        if (!cancelled) {
          setPolicy(defaultPolicy(moduleKey))
          setError(err instanceof Error ? err.message : 'Could not load organisation settings')
          setSaveState('error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [moduleKey, orgSlug])

  const markDirty = useCallback(() => {
    setError('')
    setSaveState('dirty')
  }, [])

  const setRole = useCallback((actionId: string, role: OrganizationPolicyRole, checked: boolean) => {
    setPolicy((current) => {
      const currentRoles = current.actions[actionId] ?? ALL_ROLES
      return {
        ...current,
        actions: {
          ...current.actions,
          [actionId]: {
            ...currentRoles,
            [role]: checked,
          },
        },
      }
    })
    markDirty()
  }, [markDirty])

  const setOwnerControl = useCallback((controlId: string, checked: boolean) => {
    setPolicy((current) => ({
      ...current,
      ownerControls: {
        ...current.ownerControls,
        [controlId]: checked,
      },
    }))
    markDirty()
  }, [markDirty])

  const addCustomItem = useCallback((item: OrganizationPolicyItem) => {
    setPolicy((current) => {
      const existing = current.customItems.filter((customItem) => customItem.id !== item.id)
      return {
        ...current,
        customItems: [...existing, item],
      }
    })
    markDirty()
  }, [markDirty])

  const removeCustomItem = useCallback((id: string) => {
    setPolicy((current) => ({
      ...current,
      customItems: current.customItems.filter((item) => item.id !== id),
    }))
    markDirty()
  }, [markDirty])

  const save = useCallback(async () => {
    if (!orgId || typeof fetch !== 'function') {
      setError('Organisation not loaded yet')
      setSaveState('error')
      return
    }

    setSaving(true)
    setError('')
    try {
      const visibility = policy.actions.visibility ?? ALL_ROLES
      const settings: Record<string, unknown> = {
        modulePolicies: {
          [moduleKey]: policy,
        },
      }

      if (isLegacyPortalModuleKey(moduleKey)) {
        settings.portalModules = {
          [moduleKey]: Object.values(visibility).some(Boolean),
        }
      }

      const res = await fetch(`/api/v1/organizations/${encodeURIComponent(orgId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId, 'X-Org-Slug': orgSlug },
        body: JSON.stringify({ settings }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save organisation settings')
      setSaveState('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save organisation settings')
      setSaveState('error')
    } finally {
      setSaving(false)
    }
  }, [moduleKey, orgId, orgSlug, policy])

  return {
    policy,
    loading,
    saving,
    saveState,
    error,
    setRole,
    setOwnerControl,
    addCustomItem,
    removeCustomItem,
    save,
  }
}

export function OrganizationModulePolicyRoleGrid({
  rows,
  policy,
  testIdPrefix,
  disabled,
  onRoleChange,
}: {
  rows: OrganizationPolicyActionRow[]
  policy: OrganizationModulePolicy
  testIdPrefix: string
  disabled?: boolean
  onRoleChange: (actionId: string, role: OrganizationPolicyRole, checked: boolean) => void
}) {
  return (
    <div className="mt-5 divide-y divide-[var(--color-card-border)] rounded-lg border border-[var(--color-card-border)]">
      {rows.map((row) => (
        <div key={row.id} data-testid={`${testIdPrefix}-${row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(320px,auto)]">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">{row.title}</h3>
            <p className="mt-1 text-sm text-on-surface-variant">{row.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ORGANIZATION_POLICY_ROLE_KEYS.map((role) => (
              <label key={role} className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-xs text-on-surface-variant">
                <input
                  type="checkbox"
                  checked={policy.actions[row.id]?.[role] ?? true}
                  disabled={disabled}
                  onChange={(event) => onRoleChange(row.id, role, event.target.checked)}
                  className="size-4 rounded border-[var(--color-card-border)] bg-[var(--color-background)]"
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function OrganizationOwnerControlsGrid({
  rows,
  policy,
  disabled,
  onControlChange,
}: {
  rows: OrganizationOwnerControlRow[]
  policy: OrganizationModulePolicy
  disabled?: boolean
  onControlChange: (controlId: string, checked: boolean) => void
}) {
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      {rows.map((row) => (
        <label key={row.id} className="flex min-h-24 flex-col justify-between rounded-lg border border-[var(--color-card-border)] p-4 text-sm text-on-surface-variant">
          <span>{row.label}</span>
          <input
            type="checkbox"
            checked={policy.ownerControls[row.id] ?? true}
            disabled={disabled}
            onChange={(event) => onControlChange(row.id, event.target.checked)}
            className="mt-4 size-4 rounded border-[var(--color-card-border)] bg-[var(--color-background)]"
          />
        </label>
      ))}
    </div>
  )
}

export function OrganizationModulePolicySaveBar({
  loading,
  saving,
  saveState,
  error,
  onSave,
}: {
  loading: boolean
  saving: boolean
  saveState: SaveState
  error: string
  onSave: () => void
}) {
  const label = useMemo(() => statusLabel(saveState, loading, saving, error), [error, loading, saveState, saving])
  const tone = error ? 'text-red-200' : saveState === 'saved' ? 'text-emerald-200' : 'text-on-surface-variant'

  return (
    <div className="mt-5 flex flex-col gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className={`text-xs ${tone}`}>{label}</p>
      <button
        type="button"
        onClick={onSave}
        disabled={loading || saving || saveState !== 'dirty'}
        className="pib-btn-primary justify-center text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]">save</span>
        {saving ? 'Saving' : 'Save settings'}
      </button>
    </div>
  )
}
