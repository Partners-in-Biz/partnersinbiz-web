'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  CRM_INTEGRATION_PROVIDERS,
  findProvider,
  type CrmIntegrationProvider,
  type CrmIntegrationStatus,
  type PublicCrmIntegrationView,
  type ProviderRegistryEntry,
} from '@/lib/crm/integrations/types'
import { fmtTimestamp } from '@/lib/format/timestamp'

interface CampaignSummary {
  id: string
  name: string
  status: string
}

interface IntegrationsWorkspaceProps {
  orgId?: string
  orgName?: string
}

const STATUS_STYLES: Record<CrmIntegrationStatus, string> = {
  pending: 'bg-white/10 text-[var(--color-pib-text-muted)] border border-[var(--color-pib-line-strong)]',
  active: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25',
  syncing: 'bg-amber-500/15 text-amber-300 border border-amber-500/25',
  error: 'bg-red-500/15 text-red-300 border border-red-500/25',
  paused: 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25',
  disabled: 'bg-white/10 text-[var(--color-pib-text-muted)] border border-[var(--color-pib-line-strong)]',
}

const STATUS_LABELS: Record<CrmIntegrationStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  syncing: 'Syncing',
  error: 'Error',
  paused: 'Paused',
  disabled: 'Disabled',
}

function StatusBadge({ status }: { status: CrmIntegrationStatus }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function HealthBadge({ integration }: { integration: PublicCrmIntegrationView }) {
  if (integration.status === 'error' || integration.lastSyncStats.errored > 0 || integration.lastError) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-red-500/25 bg-red-500/10 text-red-200">
        Needs review
      </span>
    )
  }
  if (integration.status === 'active' && integration.lastSyncedAt) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-emerald-500/25 bg-emerald-500/10 text-emerald-200">
        Healthy sync
      </span>
    )
  }
  if (integration.status === 'paused' || integration.status === 'disabled') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-amber-500/25 bg-amber-500/10 text-amber-200">
        Paused
      </span>
    )
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-sky-500/25 bg-sky-500/10 text-sky-200">
      Setup pending
    </span>
  )
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: string | number
  detail: string
  icon: string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            {label}
          </p>
          <p className="mt-2 truncate text-2xl font-display text-[var(--color-pib-text)]">{value}</p>
        </div>
        <span className="material-symbols-outlined rounded-lg border border-[var(--color-pib-line)] bg-white/[0.04] p-2 text-[18px] text-[var(--color-pib-text-muted)]">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{detail}</p>
    </div>
  )
}

function cadenceLabel(mins: number): string {
  if (!mins) return 'manual'
  if (mins < 60) return `every ${mins} min`
  if (mins === 60) return 'every hour'
  if (mins < 1440) return `every ${Math.round(mins / 60)} h`
  if (mins === 1440) return 'daily'
  return `every ${mins} min`
}

function statsSummary(s: PublicCrmIntegrationView['lastSyncStats']): string {
  return `${s.imported} imported · ${s.created} new · ${s.updated} updated${s.skipped ? ` · ${s.skipped} skipped` : ''}${s.errored ? ` · ${s.errored} errored` : ''}`
}

function providerSetupLabel(entry: ProviderRegistryEntry, selected: boolean, disabled: boolean): string {
  const sourceName =
    entry.provider === 'zapier'
      ? 'Zapier / n8n / Make API capture source'
      : entry.displayName
  if (disabled) return `${sourceName} setup unavailable`
  if (selected) return `Selected ${sourceName} CRM source setup`
  return `Choose ${sourceName} CRM source setup`
}

function integrationDisplayName(integration: PublicCrmIntegrationView): string {
  return integration.name.trim() || 'Integration name missing'
}

function scopedUrl(path: string, orgId?: string, params?: Record<string, string>) {
  const search = new URLSearchParams(params)
  const cleanOrgId = orgId?.trim()
  if (cleanOrgId) search.set('orgId', cleanOrgId)
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

const CADENCE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Manual only' },
  { value: 60, label: 'Every hour' },
  { value: 240, label: 'Every 4 hours' },
  { value: 1440, label: 'Daily' },
]

function ProviderTile({
  connectedCount,
  entry,
  onAdd,
  selected,
}: {
  connectedCount: number
  entry: ProviderRegistryEntry
  onAdd: (p: CrmIntegrationProvider) => void
  selected: boolean
}) {
  const disabled = entry.comingSoon || entry.configFields.length === 0
  return (
    <button
      type="button"
      aria-label={providerSetupLabel(entry, selected, disabled)}
      aria-pressed={disabled ? undefined : selected}
      onClick={() => !disabled && onAdd(entry.provider)}
      disabled={disabled}
      className={[
        'text-left p-4 rounded-xl border bg-[var(--color-pib-surface)] border-[var(--color-pib-line)] transition-colors',
        selected ? 'ring-2 ring-[var(--color-pib-accent)]/45 border-[var(--color-pib-accent)]/70 bg-[var(--color-pib-accent-soft)]' : '',
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:bg-white/[0.04] cursor-pointer',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-medium text-[var(--color-pib-text)]">{entry.displayName}</span>
        {connectedCount > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 uppercase tracking-wide">
            {connectedCount} connected
          </span>
        )}
        {entry.comingSoon && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/10 text-[var(--color-pib-text-muted)] border border-[var(--color-pib-line-strong)] uppercase tracking-wide">
            Coming soon
          </span>
        )}
        {!entry.comingSoon && entry.configFields.length === 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/25 uppercase tracking-wide">
            No setup
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--color-pib-text-muted)] leading-relaxed">{entry.description}</p>
    </button>
  )
}

function AddIntegrationForm({
  entry,
  orgId,
  integrationsEndpoint,
  onCreated,
  onCancel,
}: {
  entry: ProviderRegistryEntry
  orgId?: string
  integrationsEndpoint: string
  onCreated: (i: PublicCrmIntegrationView) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(entry.displayName)
  const [config, setConfig] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(integrationsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: entry.provider,
          name: name.trim(),
          config,
          ...(orgId ? { orgId } : {}),
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Failed to create integration')
        return
      }
      onCreated(body.data as PublicCrmIntegrationView)
    } catch {
      setError('Failed to create integration')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-[var(--color-pib-text)]">Connect {entry.displayName}</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
        >
          Cancel
        </button>
      </div>

      <div>
        <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
        />
      </div>

      {entry.configFields.map((field) => (
        <div key={field.key}>
          <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
            {field.label}{field.required ? ' *' : ''}
          </label>
          <input
            type={field.type === 'password' ? 'password' : 'text'}
            value={config[field.key] ?? ''}
            onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
            placeholder={field.placeholder}
            required={field.required}
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm font-mono"
          />
          {field.helpText && (
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">{field.helpText}</p>
          )}
        </div>
      ))}

      {error && <p className="text-sm text-[#FCA5A5]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-[var(--color-pib-text)] text-sm border border-[var(--color-pib-line)]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-50"
        >
          {submitting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </form>
  )
}

function IntegrationCard({
  integration,
  campaigns,
  integrationEndpoint,
  integrationSyncEndpoint,
  onUpdated,
  onDeleted,
}: {
  integration: PublicCrmIntegrationView
  campaigns: CampaignSummary[]
  integrationEndpoint: (id: string) => string
  integrationSyncEndpoint: (id: string) => string
  onUpdated: (i: PublicCrmIntegrationView) => void
  onDeleted: (id: string) => void
}) {
  const entry = findProvider(integration.provider)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [tagsDraft, setTagsDraft] = useState((integration.autoTags ?? []).join(', '))
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setTagsDraft((integration.autoTags ?? []).join(', '))
  }, [integration.autoTags])

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(integrationEndpoint(integration.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to update')
        return
      }
      onUpdated(json.data as PublicCrmIntegrationView)
    } catch {
      setError('Failed to update')
    } finally {
      setBusy(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch(integrationSyncEndpoint(integration.id), { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Sync failed')
        return
      }
      const data = json.data as { integration: PublicCrmIntegrationView; ok: boolean; error: string }
      onUpdated(data.integration)
      if (!data.ok && data.error) setError(data.error)
    } catch {
      setError('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleTogglePause() {
    const next = integration.status === 'paused' ? 'active' : 'paused'
    await patch({ status: next })
  }

  async function handleDelete() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(integrationEndpoint(integration.id), { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to delete')
        setBusy(false)
        return
      }
      setDeleteConfirmOpen(false)
      onDeleted(integration.id)
    } catch {
      setError('Failed to delete')
      setBusy(false)
    }
  }

  async function handleTagsBlur() {
    const next = tagsDraft.split(',').map((t) => t.trim()).filter(Boolean)
    const current = integration.autoTags ?? []
    if (next.length === current.length && next.every((t, i) => t === current[i])) return
    await patch({ autoTags: next })
  }

  function toggleCampaign(id: string) {
    const set = new Set(integration.autoCampaignIds ?? [])
    if (set.has(id)) set.delete(id)
    else set.add(id)
    patch({ autoCampaignIds: Array.from(set) })
  }

  async function handleSecretSave(key: string) {
    const v = (secretDrafts[key] ?? '').trim()
    if (!v) return
    await patch({ config: { [key]: v } })
    setSecretDrafts((prev) => ({ ...prev, [key]: '' }))
  }

  const lastSynced = fmtTimestamp(integration.lastSyncedAt)
  const isPaused = integration.status === 'paused'
  const isSyncingState = integration.status === 'syncing' || syncing
  const sensitiveFields = entry?.configFields.filter((f) => f.sensitive) ?? []
  const campaignCount = integration.autoCampaignIds?.length ?? 0
  const tagCount = integration.autoTags?.length ?? 0
  const displayName = integrationDisplayName(integration)
  const readinessItems = [
    cadenceLabel(integration.cadenceMinutes),
    integration.lastSyncedAt ? `${integration.lastSyncStats.imported} imported` : 'Never synced',
    tagCount > 0 ? `${tagCount} auto-tag${tagCount === 1 ? '' : 's'}` : 'No auto-tags',
    campaignCount > 0 ? 'Auto-enrolls' : 'No nurture routing',
  ]

  return (
    <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] overflow-hidden">
      <div className="p-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="material-symbols-outlined rounded-lg border border-[var(--color-pib-line)] bg-white/[0.04] p-2 text-[var(--color-pib-text-muted)] text-[20px]">
            extension
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-[var(--color-pib-text)] truncate">
              {displayName}
              <span className="ml-2 text-xs text-[var(--color-pib-text-muted)] font-normal">
                {entry?.displayName ?? integration.provider}
              </span>
            </p>
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
              {cadenceLabel(integration.cadenceMinutes)}
              {lastSynced && <span> · last synced {lastSynced}</span>}
            </p>
            {integration.lastSyncedAt && (
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                {statsSummary(integration.lastSyncStats)}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {readinessItems.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-[var(--color-pib-line)] bg-white/[0.03] px-2 py-0.5 text-[11px] text-[var(--color-pib-text-muted)]"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
          <StatusBadge status={integration.status} />
          <HealthBadge integration={integration} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={busy || isSyncingState || isPaused || integration.status === 'disabled'}
            className="btn-pib-accent !py-1.5 !px-3 !text-sm disabled:opacity-50"
            type="button"
          >
            {isSyncingState ? 'Syncing...' : 'Sync now'}
          </button>
          <button
            onClick={handleTogglePause}
            disabled={busy || integration.status === 'disabled'}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-[var(--color-pib-text)] text-sm border border-[var(--color-pib-line)] hover:bg-white/[0.08] disabled:opacity-50 transition-colors"
            type="button"
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={`${expanded ? 'Hide details' : 'Details'} for ${displayName}`}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-[var(--color-pib-text)] text-sm border border-[var(--color-pib-line)] hover:bg-white/[0.08] transition-colors"
            type="button"
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
          <button
            onClick={() => setDeleteConfirmOpen(true)}
            aria-label={`Delete integration ${displayName}`}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-[#FCA5A5] text-sm border border-[var(--color-pib-line)] hover:bg-red-500/10 disabled:opacity-50 transition-colors"
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      {(error || integration.lastError) && (
        <p className="px-4 pb-2 text-sm text-[#FCA5A5]">{error || integration.lastError}</p>
      )}

      {deleteConfirmOpen && (
        <div className="px-4 pb-4">
          <section
            role="alertdialog"
            aria-modal="false"
            aria-labelledby={`integration-delete-title-${integration.id}`}
            className="rounded-xl border border-red-500/25 bg-red-500/10 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 id={`integration-delete-title-${integration.id}`} className="font-medium text-red-100">
                  Delete integration &quot;{displayName}&quot;?
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-red-100/80">
                  This disconnects the CRM source, stops future syncs, and keeps imported contact history available for audit.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(false)}
                  disabled={busy}
                  aria-label={`Cancel delete integration ${displayName}`}
                  className="rounded-lg border border-red-200/20 bg-white/[0.04] px-3 py-1.5 text-sm text-red-50 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  aria-label={`Confirm delete integration ${displayName}`}
                  className="rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-1.5 text-sm font-medium text-red-50 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                >
                  {busy ? 'Deleting...' : 'Delete source'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {expanded && (
        <div className="border-t border-[var(--color-pib-line)] p-4 space-y-5">
          {Object.keys(integration.configPreview).length > 0 && (
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
                Configuration
              </label>
              <dl className="rounded-md bg-[var(--color-pib-bg)] border border-[var(--color-pib-line)] divide-y divide-[var(--color-pib-line)]">
                {Object.entries(integration.configPreview).map(([k, v]) => {
                  const field = entry?.configFields.find((f) => f.key === k)
                  return (
                    <div key={k} className="flex justify-between gap-3 px-3 py-2 text-xs">
                      <dt className="text-[var(--color-pib-text-muted)]">{field?.label ?? k}</dt>
                      <dd className="font-mono text-[var(--color-pib-text)] break-all">{v}</dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
              Auto-tags
            </label>
            <input
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              onBlur={handleTagsBlur}
              placeholder="newsletter, mailchimp"
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
            />
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
              Comma-separated. Applied to every imported contact.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
              Auto-enroll campaigns
            </label>
            {campaigns.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No active campaigns to choose from.</p>
            ) : (
              <div className="space-y-1.5">
                {campaigns.map((c) => {
                  const checked = (integration.autoCampaignIds ?? []).includes(c.id)
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCampaign(c.id)}
                        disabled={busy}
                        className="h-4 w-4"
                      />
                      <span>{c.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
              Sync cadence
            </label>
            <select
              value={integration.cadenceMinutes}
              onChange={(e) => patch({ cadenceMinutes: Number(e.target.value) })}
              disabled={busy}
              className="px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
            >
              {CADENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {sensitiveFields.length > 0 && (
            <div className="space-y-3">
              {sensitiveFields.map((f) => (
                <div key={f.key}>
                  <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
                    Update {f.label}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={secretDrafts[f.key] ?? ''}
                      onChange={(e) => setSecretDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder="Leave blank to keep current"
                      autoComplete="off"
                      className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleSecretSave(f.key)}
                      disabled={busy || !(secretDrafts[f.key] ?? '').trim()}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-[var(--color-pib-text)] text-sm border border-[var(--color-pib-line)] disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function IntegrationsWorkspace({ orgId, orgName }: IntegrationsWorkspaceProps) {
  const scopedOrgId = orgId?.trim() || undefined
  const [integrations, setIntegrations] = useState<PublicCrmIntegrationView[]>([])
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [addingProvider, setAddingProvider] = useState<CrmIntegrationProvider | null>(null)

  const integrationsEndpoint = useMemo(
    () => scopedUrl('/api/v1/crm/integrations', scopedOrgId),
    [scopedOrgId],
  )
  const campaignsEndpoint = useMemo(
    () => scopedUrl('/api/v1/campaigns', scopedOrgId, { status: 'active' }),
    [scopedOrgId],
  )
  const integrationEndpoint = useCallback(
    (integrationId: string) => scopedUrl(`/api/v1/crm/integrations/${integrationId}`, scopedOrgId),
    [scopedOrgId],
  )
  const integrationSyncEndpoint = useCallback(
    (integrationId: string) => scopedUrl(`/api/v1/crm/integrations/${integrationId}/sync`, scopedOrgId),
    [scopedOrgId],
  )

  const loadIntegrations = useCallback(() => {
    setLoading(true)
    fetch(integrationsEndpoint)
      .then((r) => r.json())
      .then((body) => setIntegrations((body.data ?? []) as PublicCrmIntegrationView[]))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [integrationsEndpoint])

  const loadCampaigns = useCallback(() => {
    fetch(campaignsEndpoint)
      .then((r) => r.json())
      .then((body) => {
        const list = (body.data ?? []) as Array<{ id: string; name: string; status: string }>
        setCampaigns(list.map((c) => ({ id: c.id, name: c.name, status: c.status })))
      })
      .catch(() => {})
  }, [campaignsEndpoint])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadIntegrations()
      loadCampaigns()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [loadIntegrations, loadCampaigns])

  function handleCreated(created: PublicCrmIntegrationView) {
    setIntegrations((prev) => [created, ...prev])
    setAddingProvider(null)
  }
  function handleUpdated(updated: PublicCrmIntegrationView) {
    setIntegrations((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }
  function handleDeleted(id: string) {
    setIntegrations((prev) => prev.filter((i) => i.id !== id))
  }

  const addingEntry = addingProvider ? findProvider(addingProvider) : null
  const firstConnectableProvider = CRM_INTEGRATION_PROVIDERS.find((entry) => !entry.comingSoon && entry.configFields.length > 0)
  const metrics = useMemo(() => {
    const connected = integrations.length
    const healthy = integrations.filter(
      (integration) => integration.status === 'active' && Boolean(integration.lastSyncedAt) && !integration.lastError && integration.lastSyncStats.errored === 0,
    ).length
    const imported = integrations.reduce((sum, integration) => sum + (integration.lastSyncStats.imported ?? 0), 0)
    const attention = integrations.filter(
      (integration) =>
        integration.status === 'error' ||
        integration.status === 'pending' ||
        integration.status === 'paused' ||
        integration.lastSyncStats.errored > 0 ||
        Boolean(integration.lastError),
    ).length
    return { connected, healthy, imported, attention }
  }, [integrations])
  const connectedByProvider = useMemo(() => {
    return integrations.reduce<Record<CrmIntegrationProvider, number>>(
      (acc, integration) => {
        acc[integration.provider] += 1
        return acc
      },
      { mailchimp: 0, hubspot: 0, gmail: 0, zapier: 0 },
    )
  }, [integrations])

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">{orgName || 'CRM'}</p>
        <h1 className="pib-page-title mt-2">Integration command center</h1>
        <p className="pib-page-sub max-w-2xl">
          Monitor every external system that feeds your CRM. Keep imports healthy, credentials current, contacts tagged, and nurture routing intentional.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Connected sources"
          value={metrics.connected}
          detail="External systems currently configured for CRM intake."
          icon="hub"
        />
        <MetricCard
          label="Healthy syncs"
          value={`${metrics.healthy}/${metrics.connected}`}
          detail="Active integrations with a clean latest sync."
          icon="sync_saved_locally"
        />
        <MetricCard
          label="Imported contacts"
          value={metrics.imported}
          detail="Contacts pulled during the most recent sync cycle."
          icon="groups"
        />
        <MetricCard
          label="Needs attention"
          value={metrics.attention}
          detail="Pending, paused, or failed integrations to review."
          icon="priority_high"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <h2 className="text-sm font-medium text-[var(--color-pib-text)] mb-3">Available providers</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CRM_INTEGRATION_PROVIDERS.map((entry) => (
              <ProviderTile
                key={entry.provider}
                connectedCount={connectedByProvider[entry.provider]}
                entry={entry}
                onAdd={(p) => setAddingProvider(p)}
                selected={addingProvider === entry.provider}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4">
          <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Sync discipline</h2>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Healthy CRM imports need three things: a recent sync, source tags, and a deliberate nurture path for the right leads.
          </p>
          <div className="mt-4 space-y-2">
            {[
              ['Credentials', 'Rotate secrets when providers report auth errors.'],
              ['Attribution', 'Use auto-tags so imported contacts keep source context.'],
              ['Follow-up', 'Enroll only the imports that should enter a campaign.'],
            ].map(([label, detail]) => (
              <div key={label} className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] p-3">
                <p className="text-sm font-medium text-[var(--color-pib-text)]">{label}</p>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {addingEntry && (
        <AddIntegrationForm
          entry={addingEntry}
          orgId={scopedOrgId}
          integrationsEndpoint={integrationsEndpoint}
          onCreated={handleCreated}
          onCancel={() => setAddingProvider(null)}
        />
      )}

      <div>
        <h2 className="text-sm font-medium text-[var(--color-pib-text)] mb-3">Connected integrations</h2>
        {loading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="pib-skeleton h-20 rounded-xl" />
            ))}
          </div>
        ) : integrations.length === 0 ? (
          <div className="overflow-hidden rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="p-5">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-pib-accent)]/25 bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                  <span className="material-symbols-outlined text-[21px]" aria-hidden>
                    hub
                  </span>
                </span>
                <p className="eyebrow !text-[10px]">Source launch</p>
                <h3 className="mt-3 text-xl font-semibold text-[var(--color-pib-text)]">
                  No connected CRM sources yet.
                </h3>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  Connect the first source so a CEO can see where contacts come from, whether imports are healthy, and which employees own the next follow-up.
                </p>
                {firstConnectableProvider && (
                  <button
                    type="button"
                    onClick={() => setAddingProvider(firstConnectableProvider.provider)}
                    className="btn-pib-accent mt-5 inline-flex items-center gap-1.5 text-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden>
                      add_link
                    </span>
                    Connect {firstConnectableProvider.displayName}
                  </button>
                )}
              </div>
              <div className="border-t border-[var(--color-pib-line)] bg-black/10 p-4 lg:border-l lg:border-t-0">
                <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                  Launch checklist
                </p>
                <div className="mt-4 space-y-3">
                  {[
                    ['Source owner', 'Know who owns the provider account and credentials.'],
                    ['Import routing', 'Apply tags and campaigns before contacts hit sales.'],
                    ['Sync health', 'Run the first sync and watch error counts.'],
                  ].map(([label, copy]) => (
                    <div key={label} className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                      <p className="text-sm font-medium text-[var(--color-pib-text)]">{label}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{copy}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {integrations.map((i) => (
              <IntegrationCard
                key={i.id}
                integration={i}
                campaigns={campaigns}
                integrationEndpoint={integrationEndpoint}
                integrationSyncEndpoint={integrationSyncEndpoint}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
