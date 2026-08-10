'use client'

/**
 * Shared org-role editor body used by:
 * - Org chart drawer (Role tab)
 * - Agent detail panel (Org role tab)
 *
 * Saves only Firestore agent_org_nodes by default. Optional
 * syncLiveRuntime pushes model/effort into the bound agent's live Hermes
 * profile (admin sidecar) so machines pick up the same Auto defaults.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AgentOrgNode, OrgAssignableFrom, OrgNodeStatus } from '@/lib/agent-org/types'
import { DEFAULT_ORG_NODE_DELEGATION } from '@/lib/agent-org/types'
import { buildRuntimePatchFromOrgDefaults } from '@/lib/agent-org/syncRuntime'
import { AGENT_EFFORT_OPTIONS, AGENT_MODEL_OPTIONS } from '@/lib/agents/runRouting'
import type { AgentRuntimeModelSettings } from '@/lib/agents/runtime-config'

/** Colour keys used across the agents design system (seed + linked agents). */
const COLOR_KEYS = [
  'violet', 'sky', 'indigo', 'emerald', 'pink', 'amber', 'teal', 'rose',
  'green', 'cyan', 'purple', 'blue', 'lime', 'orange', 'slate',
] as const

const SWATCH: Record<string, string> = {
  violet: 'bg-violet-500', sky: 'bg-sky-500', indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500', pink: 'bg-pink-500', amber: 'bg-amber-500',
  teal: 'bg-teal-500', rose: 'bg-rose-500', green: 'bg-green-500',
  cyan: 'bg-cyan-500', purple: 'bg-purple-500', blue: 'bg-blue-500',
  lime: 'bg-lime-500', orange: 'bg-orange-500', slate: 'bg-slate-500',
}

export interface OrgRoleFormProps {
  orgId: string
  /** null = create mode. */
  node: AgentOrgNode | null
  /** All nodes of the org — used for the reportsTo select. */
  nodes: AgentOrgNode[]
  canEdit?: boolean
  /** Prefer live runtime push when a bound agentId is present. */
  defaultSyncLiveRuntime?: boolean
  /**
   * Chart CRUD base path.
   * Admin: `/api/v1/admin/agent-org`
   * Portal: `/api/v1/portal/settings/agents/org-chart`
   */
  apiBase?: string
  /** When false, hide/disable push-to-live Hermes (portal org admins without admin agent APIs). */
  allowLiveRuntimeSync?: boolean
  onSaved: (node: AgentOrgNode | null) => void
  onDeleted?: () => void
  onCancel?: () => void
  /** Hide footer cancel when parent drawer already has one. */
  showCancel?: boolean
  /** Override the read-only error copy. */
  readOnlyMessage?: string
}

interface EditorForm {
  name: string
  title: string
  agentId: string
  reportsTo: string
  capabilities: string
  defaultModel: string
  defaultEffort: string
  assignableFrom: OrgAssignableFrom
  escalateToManager: boolean
  allowLateral: boolean
  status: OrgNodeStatus
  iconKey: string
  colorKey: string
  syncLiveRuntime: boolean
}

function formFrom(node: AgentOrgNode | null, defaultSyncLiveRuntime: boolean): EditorForm {
  const delegation = node?.delegation ?? DEFAULT_ORG_NODE_DELEGATION
  return {
    name: node?.name ?? '',
    title: node?.title ?? '',
    agentId: node?.agentId ?? '',
    reportsTo: node?.reportsTo ?? '',
    capabilities: (node?.capabilities ?? []).join(', '),
    defaultModel: node?.defaultModel ?? '',
    defaultEffort: node?.defaultEffort ?? '',
    assignableFrom: delegation.assignableFrom,
    escalateToManager: delegation.escalateToManager,
    allowLateral: delegation.allowLateral,
    status: node?.status ?? 'active',
    iconKey: node?.iconKey ?? 'smart_toy',
    colorKey: node?.colorKey ?? 'violet',
    syncLiveRuntime: Boolean(defaultSyncLiveRuntime && Boolean(node?.agentId)),
  }
}

async function pushLiveRuntime(agentId: string, form: EditorForm): Promise<string | null> {
  if (!form.syncLiveRuntime || !agentId) return null
  if (!form.defaultModel && !form.defaultEffort) {
    return 'Org defaults saved. Skipped live runtime sync (no model/effort set).'
  }

  const getRes = await fetch(`/api/v1/admin/agents/${encodeURIComponent(agentId)}/runtime-model`)
  const getBody = await getRes.json().catch(() => ({}))
  if (!getRes.ok) {
    throw new Error(getBody?.error ?? `Could not read live runtime for ${agentId} (${getRes.status})`)
  }

  const current = (getBody.data?.settings ?? null) as AgentRuntimeModelSettings | null
  if (!current || !current.primaryProvider || !current.primaryModel) {
    throw new Error(`Live runtime for ${agentId} has no primary provider/model to patch`)
  }

  const next = buildRuntimePatchFromOrgDefaults(current, {
    defaultModel: form.defaultModel || null,
    defaultEffort: form.defaultEffort || null,
  })

  const putRes = await fetch(`/api/v1/admin/agents/${encodeURIComponent(agentId)}/runtime-model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
  const putBody = await putRes.json().catch(() => ({}))
  if (!putRes.ok) {
    throw new Error(putBody?.error ?? `Live runtime sync failed (${putRes.status})`)
  }

  const registryNote = putBody.data?.registrySyncError
    ? ` Registry label sync warning: ${putBody.data.registrySyncError}`
    : ''
  return `Org defaults saved and pushed to live Hermes profile for ${agentId}.${registryNote}`
}

export default function OrgRoleForm({
  orgId,
  node,
  nodes,
  canEdit = true,
  defaultSyncLiveRuntime = true,
  apiBase = '/api/v1/admin/agent-org',
  allowLiveRuntimeSync = true,
  onSaved,
  onDeleted,
  onCancel,
  showCancel = true,
  readOnlyMessage = 'Only organisation admins can edit org roles.',
}: OrgRoleFormProps) {
  const [form, setForm] = useState<EditorForm>(() =>
    formFrom(node, allowLiveRuntimeSync ? defaultSyncLiveRuntime : false),
  )
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setForm(formFrom(node, allowLiveRuntimeSync ? defaultSyncLiveRuntime : false))
    setBusy(null)
    setError(null)
    setMessage(null)
  }, [node, defaultSyncLiveRuntime, allowLiveRuntimeSync])

  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const reportOptions = useMemo(() => {
    return nodes
      .filter((n) => n.id !== node?.id)
      .map((n) => ({ value: n.id, label: `${n.name}${n.agentId ? ` · ${n.agentId}` : ''}` }))
  }, [nodes, node])

  const isEdit = Boolean(node?.id)
  const boundAgentId = form.agentId.trim()
  const inputCls = 'pib-input w-full'

  const handleSave = async () => {
    if (!canEdit) {
      setError(readOnlyMessage)
      return
    }
    const name = form.name.trim()
    const title = form.title.trim()
    if (!name || !title) {
      setError('Name and title are required.')
      return
    }
    setBusy('save')
    setError(null)
    setMessage(null)
    const payload = {
      orgId,
      name,
      title,
      agentId: boundAgentId || null,
      reportsTo: form.reportsTo || null,
      capabilities: form.capabilities.split(',').map((c) => c.trim()).filter(Boolean),
      defaultModel: form.defaultModel || null,
      defaultEffort: form.defaultEffort || null,
      delegation: {
        assignableFrom: form.assignableFrom,
        escalateToManager: form.escalateToManager,
        allowLateral: form.allowLateral,
      },
      status: form.status,
      iconKey: form.iconKey.trim() || 'smart_toy',
      colorKey: form.colorKey,
    }
    try {
      const res = await fetch(
        isEdit ? `${apiBase}/${encodeURIComponent(node!.id)}` : apiBase,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.error ?? `Save failed (${res.status})`)
      }

      const savedNode = (body.data?.node ?? body.data ?? null) as AgentOrgNode | null
      let syncNote: string | null = null
      if (allowLiveRuntimeSync && boundAgentId && form.syncLiveRuntime) {
        try {
          syncNote = await pushLiveRuntime(boundAgentId, form)
        } catch (syncErr) {
          // Org node already saved — surface sync failure without rolling back Firestore.
          setError(syncErr instanceof Error ? syncErr.message : 'Live runtime sync failed')
          onSaved(savedNode)
          setBusy(null)
          return
        }
      }

      setMessage(
        syncNote ??
          (allowLiveRuntimeSync
            ? 'Org role saved (task defaults only — live Hermes profile unchanged).'
            : 'Org role saved. Live Hermes profiles are linked via bound agentId + machine install (Pip skill).'),
      )
      onSaved(savedNode)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    if (!canEdit || !node || !onDeleted) return
    const ok = window.confirm(
      `Delete "${node.name}"?\n\nChildren will be force-reparented to its manager (if any). This cannot be undone.`,
    )
    if (!ok) return
    setBusy('delete')
    setError(null)
    setMessage(null)
    try {
      const qs = new URLSearchParams({ force: 'true' })
      if (apiBase.includes('/admin/')) qs.set('orgId', orgId)
      const res = await fetch(
        `${apiBase}/${encodeURIComponent(node.id)}?${qs.toString()}`,
        { method: 'DELETE' },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.error ?? `Delete failed (${res.status})`)
      }
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
          >
            {error}
          </div>
        )}
        {message && !error && (
          <div
            role="status"
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
          >
            {message}
          </div>
        )}

        <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
          <strong className="text-[var(--color-pib-text)]">Two layers.</strong>{' '}
          Org role defaults fill Kanban task model/effort when empty.
          Live Auto model / skills / cron / env live on the bound Hermes profile
          {boundAgentId ? ` (${boundAgentId})` : ''}. Tick sync below to push model+effort onto that machine profile.
        </div>

        <div className="space-y-2">
          <label htmlFor="org-node-name" className="pib-label block">Name *</label>
          <input
            id="org-node-name"
            className={inputCls}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Pip"
            aria-label="Name"
            disabled={!canEdit || busy !== null}
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="org-node-title" className="pib-label block">Title *</label>
          <input
            id="org-node-title"
            className={inputCls}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. CEO · Coordinator"
            aria-label="Title"
            disabled={!canEdit || busy !== null}
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="org-node-agent-id" className="pib-label block">Agent id</label>
          <input
            id="org-node-agent-id"
            className={inputCls}
            value={form.agentId}
            onChange={(e) => set('agentId', e.target.value)}
            placeholder="e.g. theo — leave empty for an unbound role"
            aria-label="Agent id"
            disabled={!canEdit || busy !== null}
          />
          <p className="text-[11px] text-[var(--color-pib-text-faint)]">
            Binds this node to a runtime agent. Empty = role placeholder.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="org-node-reports-to" className="pib-label block">Reports to</label>
          <select
            id="org-node-reports-to"
            className={inputCls}
            value={form.reportsTo}
            onChange={(e) => set('reportsTo', e.target.value)}
            aria-label="Reports to"
            disabled={!canEdit || busy !== null}
          >
            <option value="">(root)</option>
            {reportOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="org-node-capabilities" className="pib-label block">Capabilities</label>
          <input
            id="org-node-capabilities"
            className={inputCls}
            value={form.capabilities}
            onChange={(e) => set('capabilities', e.target.value)}
            placeholder="routing, projects, approvals"
            aria-label="Capabilities"
            disabled={!canEdit || busy !== null}
          />
          <p className="text-[11px] text-[var(--color-pib-text-faint)]">Comma-separated capability keys.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label htmlFor="org-node-default-model" className="pib-label block">Task default model</label>
            <select
              id="org-node-default-model"
              className={inputCls}
              value={form.defaultModel}
              onChange={(e) => set('defaultModel', e.target.value)}
              aria-label="Default model"
              disabled={!canEdit || busy !== null}
            >
              <option value="">(org default)</option>
              {AGENT_MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="org-node-default-effort" className="pib-label block">Task default effort</label>
            <select
              id="org-node-default-effort"
              className={inputCls}
              value={form.defaultEffort}
              onChange={(e) => set('defaultEffort', e.target.value)}
              aria-label="Default effort"
              disabled={!canEdit || busy !== null}
            >
              <option value="">(org default)</option>
              {AGENT_EFFORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {allowLiveRuntimeSync && boundAgentId ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3 text-sm text-[var(--color-pib-text)]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded accent-cyan-400"
              checked={form.syncLiveRuntime}
              onChange={(e) => set('syncLiveRuntime', e.target.checked)}
              disabled={!canEdit || busy !== null}
              aria-label="Also push model and effort to live Hermes profile"
            />
            <span>
              <span className="font-medium">Also push to live Hermes profile</span>
              <span className="mt-0.5 block text-[11px] text-[var(--color-pib-text-muted)]">
                Writes Auto primary model + reasoning effort on the bound machine profile
                ({boundAgentId}) via the admin sidecar, then restarts that gateway.
                Does not fan out to every linked device automatically — only the agent&apos;s
                configured runtime target (usually VPS Hermes).
              </span>
            </span>
          </label>
        ) : (
          <p className="text-[11px] text-[var(--color-pib-text-faint)]">
            Bind an agent id to enable live machine sync and the full runtime tabs.
          </p>
        )}

        <div className="space-y-2">
          <label htmlFor="org-node-assignable-from" className="pib-label block">Assignable from</label>
          <select
            id="org-node-assignable-from"
            className={inputCls}
            value={form.assignableFrom}
            onChange={(e) => set('assignableFrom', e.target.value as OrgAssignableFrom)}
            aria-label="Assignable from"
            disabled={!canEdit || busy !== null}
          >
            <option value="anyone">Anyone</option>
            <option value="manager_only">Manager only</option>
            <option value="manager_and_peers">Manager and peers</option>
          </select>
        </div>

        <div className="space-y-2 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-pib-text)]">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-cyan-400"
              checked={form.escalateToManager}
              onChange={(e) => set('escalateToManager', e.target.checked)}
              aria-label="Escalate blocked work to manager"
              disabled={!canEdit || busy !== null}
            />
            Escalate blocked work to manager
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-pib-text)]">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-cyan-400"
              checked={form.allowLateral}
              onChange={(e) => set('allowLateral', e.target.checked)}
              aria-label="Allow lateral peer assignment"
              disabled={!canEdit || busy !== null}
            />
            Allow lateral (peer) assignment
          </label>
        </div>

        <div className="space-y-2">
          <label htmlFor="org-node-status" className="pib-label block">Status</label>
          <select
            id="org-node-status"
            className={inputCls}
            value={form.status}
            onChange={(e) => set('status', e.target.value as OrgNodeStatus)}
            aria-label="Status"
            disabled={!canEdit || busy !== null}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label htmlFor="org-node-icon-key" className="pib-label block">Icon key</label>
            <input
              id="org-node-icon-key"
              className={inputCls}
              value={form.iconKey}
              onChange={(e) => set('iconKey', e.target.value)}
              placeholder="e.g. hub, code, search"
              aria-label="Icon key"
              disabled={!canEdit || busy !== null}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="org-node-color-key" className="pib-label block">Colour</label>
            <select
              id="org-node-color-key"
              className={inputCls}
              value={form.colorKey}
              onChange={(e) => set('colorKey', e.target.value)}
              aria-label="Colour"
              disabled={!canEdit || busy !== null}
            >
              {COLOR_KEYS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Colour swatches">
              {COLOR_KEYS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`h-3 w-3 rounded-full ${SWATCH[c]} ${form.colorKey === c ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-[var(--color-pib-bg)]' : ''}`}
                  title={c}
                  aria-label={`Colour ${c}`}
                  aria-pressed={form.colorKey === c}
                  disabled={!canEdit || busy !== null}
                  onClick={() => set('colorKey', c)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--color-pib-line)] pt-4">
        <div>
          {isEdit && onDeleted && canEdit && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy !== null}
              className="btn-pib-ghost btn-pib-sm font-label text-red-400 hover:text-red-300 disabled:opacity-50"
              aria-label={`Delete ${node!.name}`}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showCancel && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy !== null}
              className="btn-pib-ghost btn-pib-sm font-label disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={handleSave}
              disabled={busy !== null}
              className="btn-pib-primary btn-pib-sm font-label disabled:opacity-50"
              aria-label={isEdit ? 'Save node' : 'Create node'}
            >
              {busy === 'save' ? 'Saving…' : isEdit ? 'Save role' : 'Create role'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
