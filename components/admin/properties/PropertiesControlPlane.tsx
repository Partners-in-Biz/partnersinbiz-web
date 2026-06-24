'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Surface, StatusPill, DialogDrawer, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet, apiSend, formatDateTime } from '@/components/admin/orgs/OrgDetailApi'

type FlagType = 'boolean' | 'string' | 'number'

interface FlagDef {
  key: string
  type: FlagType
  defaultValue: boolean | string | number
  description: string
  createdAt: string | null
  updatedAt: string | null
  overrideCount: number
}

interface OrgOverride {
  flagKey: string
  orgId: string
  orgName: string
  value: unknown
}

interface OrgRef {
  id: string
  name: string
}

interface AuditRecord {
  id: string
  action: string
  orgId: string | null
  summary: string
  actorUid: string
  actorRole: string
  createdAt: string | null
}

interface ControlPlaneData {
  flags: FlagDef[]
  orgOverrides: OrgOverride[]
  orgs: OrgRef[]
  audit: AuditRecord[]
}

const FLAG_TYPES: FlagType[] = ['boolean', 'string', 'number']

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export function PropertiesControlPlane() {
  const [data, setData] = useState<ControlPlaneData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refetch = useCallback(async () => {
    try {
      const d = await apiGet<ControlPlaneData>('/api/v1/admin/properties')
      setData({
        flags: d.flags || [],
        orgOverrides: d.orgOverrides || [],
        orgs: d.orgs || [],
        audit: d.audit || [],
      })
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load control plane')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  // ── Create / edit flag dialog state ─────────────────────────────────────
  const [flagDialogOpen, setFlagDialogOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formType, setFormType] = useState<FlagType>('boolean')
  const [formDefault, setFormDefault] = useState<string>('false')
  const [formDescription, setFormDescription] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  function openCreate() {
    setEditingKey(null)
    setFormKey('')
    setFormType('boolean')
    setFormDefault('false')
    setFormDescription('')
    setFormError('')
    setFlagDialogOpen(true)
  }

  function openEdit(flag: FlagDef) {
    setEditingKey(flag.key)
    setFormKey(flag.key)
    setFormType(flag.type)
    setFormDefault(renderValue(flag.defaultValue))
    setFormDescription(flag.description)
    setFormError('')
    setFlagDialogOpen(true)
  }

  function defaultValueForPayload(): boolean | string | number {
    if (formType === 'boolean') return formDefault === 'true'
    if (formType === 'number') return Number(formDefault)
    return formDefault
  }

  async function saveFlag() {
    setSaving(true)
    setFormError('')
    try {
      const defaultValue = defaultValueForPayload()
      if (editingKey) {
        await apiSend(`/api/v1/admin/properties/${encodeURIComponent(editingKey)}`, 'PUT', {
          type: formType,
          defaultValue,
          description: formDescription,
        })
      } else {
        await apiSend('/api/v1/admin/properties', 'POST', {
          key: formKey.trim().toLowerCase(),
          type: formType,
          defaultValue,
          description: formDescription,
        })
      }
      setFlagDialogOpen(false)
      await refetch()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save flag')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete flag dialog state ────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<FlagDef | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      await apiSend(`/api/v1/admin/properties/${encodeURIComponent(deleteTarget.key)}`, 'DELETE')
      setDeleteTarget(null)
      await refetch()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete flag')
    } finally {
      setDeleting(false)
    }
  }

  // ── Add / edit override form state ──────────────────────────────────────
  const [ovFlag, setOvFlag] = useState('')
  const [ovOrg, setOvOrg] = useState('')
  const [ovValue, setOvValue] = useState('')
  const [ovError, setOvError] = useState('')
  const [ovSaving, setOvSaving] = useState(false)

  const selectedFlagDef = useMemo(
    () => data?.flags.find((f) => f.key === ovFlag) ?? null,
    [data, ovFlag],
  )

  function overridePayloadValue(): unknown {
    if (!selectedFlagDef) return ovValue
    if (selectedFlagDef.type === 'boolean') return ovValue === 'true'
    if (selectedFlagDef.type === 'number') return Number(ovValue)
    return ovValue
  }

  async function saveOverride() {
    if (!ovFlag || !ovOrg) {
      setOvError('Pick a flag and an org')
      return
    }
    setOvSaving(true)
    setOvError('')
    try {
      await apiSend(`/api/v1/admin/properties/${encodeURIComponent(ovFlag)}/overrides`, 'PUT', {
        orgId: ovOrg,
        value: overridePayloadValue(),
      })
      setOvValue('')
      await refetch()
    } catch (e) {
      setOvError(e instanceof Error ? e.message : 'Failed to set override')
    } finally {
      setOvSaving(false)
    }
  }

  async function clearOverride(flagKey: string, orgId: string) {
    setOvError('')
    try {
      await apiSend(`/api/v1/admin/properties/${encodeURIComponent(flagKey)}/overrides`, 'PUT', {
        orgId,
        value: null,
      })
      await refetch()
    } catch (e) {
      setOvError(e instanceof Error ? e.message : 'Failed to clear override')
    }
  }

  // ── Derived metrics ─────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const flags = data?.flags ?? []
    return {
      total: flags.length,
      overrides: data?.orgOverrides.length ?? 0,
      boolean: flags.filter((f) => f.type === 'boolean').length,
      string: flags.filter((f) => f.type === 'string').length,
      number: flags.filter((f) => f.type === 'number').length,
    }
  }, [data])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Platform config</p>
        <h1 className="pib-page-title mt-2">Feature-flag control plane</h1>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Define global feature flags, set per-org overrides, and audit every change. Flag definitions live in
          <code className="mx-1">platform_feature_flags</code>; overrides live on each organisation record.
        </p>
        <div className="mt-5">
          <button type="button" className="pib-btn-primary" onClick={openCreate}>
            Create flag
          </button>
        </div>
      </header>

      {error && <div className="pib-card border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Loading control plane…</div>
      ) : data ? (
        <>
          {/* Metrics */}
          <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
            {[
              { label: 'Total flags', value: metrics.total },
              { label: 'Org overrides', value: metrics.overrides },
              { label: 'Boolean', value: metrics.boolean },
              { label: 'String', value: metrics.string },
              { label: 'Number', value: metrics.number },
            ].map((m) => (
              <div key={m.label} className="pib-card p-5">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{m.label}</p>
                <p className="mt-3 text-2xl font-semibold text-on-surface">{m.value}</p>
              </div>
            ))}
          </section>

          {/* Flags table */}
          <Surface header={<span className="font-label">Feature flags</span>} className="overflow-hidden">
            {data.flags.length === 0 ? (
              <EmptyState
                icon="flag"
                title="No flags defined yet"
                description="Create your first global feature flag to start gating functionality."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      <th className="px-4 py-3">Key</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Default</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Overrides</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.flags.map((flag) => (
                      <tr key={flag.key} className="border-b border-[var(--color-pib-line)]/60 align-top last:border-b-0">
                        <td className="px-4 py-3"><code className="text-sm text-on-surface">{flag.key}</code></td>
                        <td className="px-4 py-3"><StatusPill tone="info">{flag.type}</StatusPill></td>
                        <td className="px-4 py-3 text-sm text-on-surface"><code>{renderValue(flag.defaultValue)}</code></td>
                        <td className="px-4 py-3 text-sm text-on-surface-variant">{flag.description || '—'}</td>
                        <td className="px-4 py-3">
                          <StatusPill tone={flag.overrideCount > 0 ? 'accent' : 'neutral'}>
                            {flag.overrideCount}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button type="button" className="pib-btn-ghost text-xs" onClick={() => openEdit(flag)}>Edit</button>
                            <button type="button" className="pib-btn-ghost text-xs text-red-400" onClick={() => { setDeleteTarget(flag); setDeleteError('') }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Surface>

          {/* Per-org overrides */}
          <Surface header={<span className="font-label">Per-org overrides</span>} className="overflow-hidden">
            {ovError && <p className="px-4 pt-3 text-sm text-red-400">{ovError}</p>}
            {data.orgOverrides.length === 0 ? (
              <div className="px-4 py-6 text-sm text-on-surface-variant">No per-org overrides set.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      <th className="px-4 py-3">Flag</th>
                      <th className="px-4 py-3">Org</th>
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orgOverrides.map((o) => (
                      <tr key={`${o.flagKey}:${o.orgId}`} className="border-b border-[var(--color-pib-line)]/60 last:border-b-0">
                        <td className="px-4 py-3"><code className="text-sm text-on-surface">{o.flagKey}</code></td>
                        <td className="px-4 py-3 text-sm text-on-surface">{o.orgName}<span className="ml-2 text-xs text-on-surface-variant">{o.orgId}</span></td>
                        <td className="px-4 py-3 text-sm text-on-surface"><code>{renderValue(o.value)}</code></td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="pib-btn-ghost text-xs"
                              onClick={() => { setOvFlag(o.flagKey); setOvOrg(o.orgId); setOvValue(renderValue(o.value)) }}
                            >
                              Edit
                            </button>
                            <button type="button" className="pib-btn-ghost text-xs text-red-400" onClick={() => clearOverride(o.flagKey, o.orgId)}>Clear</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-[var(--color-pib-line)] p-4">
              <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Add / edit override</p>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <select className="pib-input" value={ovFlag} onChange={(e) => { setOvFlag(e.target.value); setOvValue('') }}>
                  <option value="">Select flag…</option>
                  {data.flags.map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
                </select>
                <select className="pib-input" value={ovOrg} onChange={(e) => setOvOrg(e.target.value)}>
                  <option value="">Select org…</option>
                  {data.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                {selectedFlagDef?.type === 'boolean' ? (
                  <select className="pib-input" value={ovValue || 'true'} onChange={(e) => setOvValue(e.target.value)}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className="pib-input"
                    type={selectedFlagDef?.type === 'number' ? 'number' : 'text'}
                    placeholder="value"
                    value={ovValue}
                    onChange={(e) => setOvValue(e.target.value)}
                  />
                )}
                <button type="button" className="pib-btn-primary" disabled={ovSaving || !ovFlag || !ovOrg} onClick={saveOverride}>
                  {ovSaving ? 'Saving…' : 'Set override'}
                </button>
              </div>
            </div>
          </Surface>

          {/* Audit log */}
          <Surface header={<span className="font-label">Recent feature-flag activity</span>} className="overflow-hidden">
            {data.audit.length === 0 ? (
              <div className="px-4 py-6 text-sm text-on-surface-variant">No feature-flag changes recorded yet.</div>
            ) : (
              <div className="divide-y divide-[var(--color-pib-line)]/60">
                {data.audit.map((a) => (
                  <div key={a.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-on-surface">{a.summary}</p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        <code>{a.action}</code> · {a.actorUid || 'unknown'} ({a.actorRole || '—'})
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-on-surface-variant">{formatDateTime(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </Surface>
        </>
      ) : null}

      {/* Create / edit flag dialog */}
      <DialogDrawer
        open={flagDialogOpen}
        title={editingKey ? `Edit flag "${editingKey}"` : 'Create feature flag'}
        description={editingKey ? 'Update the type, default, or description.' : 'Define a new global feature flag.'}
        onClose={() => setFlagDialogOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={() => setFlagDialogOpen(false)}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={saving || (!editingKey && !formKey.trim())} onClick={saveFlag}>
              {saving ? 'Saving…' : editingKey ? 'Save changes' : 'Create flag'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          {!editingKey && (
            <label className="block">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Key</span>
              <input
                className="pib-input mt-1 w-full"
                placeholder="my_feature.flag"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
              />
              <span className="mt-1 block text-xs text-on-surface-variant">lowercase, letters/numbers/._-, starts with a letter</span>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Type</span>
            <select
              className="pib-input mt-1 w-full"
              value={formType}
              onChange={(e) => {
                const t = e.target.value as FlagType
                setFormType(t)
                setFormDefault(t === 'boolean' ? 'false' : t === 'number' ? '0' : '')
              }}
            >
              {FLAG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Default value</span>
            {formType === 'boolean' ? (
              <select className="pib-input mt-1 w-full" value={formDefault} onChange={(e) => setFormDefault(e.target.value)}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                className="pib-input mt-1 w-full"
                type={formType === 'number' ? 'number' : 'text'}
                value={formDefault}
                onChange={(e) => setFormDefault(e.target.value)}
              />
            )}
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Description</span>
            <textarea
              className="pib-input mt-1 w-full"
              rows={2}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />
          </label>
        </div>
      </DialogDrawer>

      {/* Delete flag dialog */}
      <DialogDrawer
        open={deleteTarget !== null}
        title={`Delete flag "${deleteTarget?.key}"?`}
        description="This removes the global flag definition. Per-org overrides are not deleted and will be orphaned."
        onClose={() => setDeleteTarget(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={deleting} onClick={confirmDelete}>
              {deleting ? 'Deleting…' : 'Delete flag'}
            </button>
          </div>
        }
      >
        {deleteError && <p className="mb-3 text-sm text-red-400">{deleteError}</p>}
        <p className="text-sm text-on-surface-variant">
          {deleteTarget && deleteTarget.overrideCount > 0 ? (
            <>This flag has <strong className="text-on-surface">{deleteTarget.overrideCount}</strong> per-org override{deleteTarget.overrideCount === 1 ? '' : 's'} that will be orphaned.</>
          ) : (
            'This flag has no per-org overrides.'
          )}
        </p>
      </DialogDrawer>
    </div>
  )
}
