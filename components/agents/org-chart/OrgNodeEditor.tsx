'use client'

/**
 * OrgNodeEditor — slide-over drawer for creating / editing an agent org node.
 *
 * Self-contained: performs POST (create), PATCH (edit) and DELETE (force)
 * against the /api/v1/admin/agent-org routes, then reports back via
 * onSaved / onDeleted so the parent can refetch the chart.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AgentOrgNode, OrgAssignableFrom, OrgNodeStatus } from '@/lib/agent-org/types'
import { DEFAULT_ORG_NODE_DELEGATION } from '@/lib/agent-org/types'
import { AGENT_EFFORT_OPTIONS, AGENT_MODEL_OPTIONS } from '@/lib/agents/runRouting'

export interface OrgNodeEditorProps {
  open: boolean
  orgId: string
  /** null = create mode. */
  node: AgentOrgNode | null
  /** All nodes of the org — used for the reportsTo select. */
  nodes: AgentOrgNode[]
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}

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
}

function formFrom(node: AgentOrgNode | null): EditorForm {
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
  }
}

export default function OrgNodeEditor({
  open,
  orgId,
  node,
  nodes,
  onClose,
  onSaved,
  onDeleted,
}: OrgNodeEditorProps) {
  const [form, setForm] = useState<EditorForm>(() => formFrom(node))
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(formFrom(node))
    setBusy(null)
    setError(null)
  }, [open, node])

  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const reportOptions = useMemo(() => {
    return nodes
      .filter((n) => n.id !== node?.id)
      .map((n) => ({ value: n.id, label: `${n.name}${n.agentId ? ` · ${n.agentId}` : ''}` }))
  }, [nodes, node])

  if (!open) return null

  const isEdit = node !== null

  const handleSave = async () => {
    const name = form.name.trim()
    const title = form.title.trim()
    if (!name || !title) {
      setError('Name and title are required.')
      return
    }
    setBusy('save')
    setError(null)
    const payload = {
      orgId,
      name,
      title,
      agentId: form.agentId.trim() || null,
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
        isEdit ? `/api/v1/admin/agent-org/${encodeURIComponent(node!.id)}` : '/api/v1/admin/agent-org',
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
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    if (!node) return
    const ok = window.confirm(
      `Delete "${node.name}"?\n\nChildren will be force-reparented to its manager (if any). This cannot be undone.`,
    )
    if (!ok) return
    setBusy('delete')
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/admin/agent-org/${encodeURIComponent(node.id)}?orgId=${encodeURIComponent(orgId)}&force=true`,
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

  const inputCls = 'pib-input w-full'

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit ${node!.name}` : 'Add org chart node'}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-pib-line)] px-5 py-4">
          <div className="min-w-0">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-faint)]">
              {isEdit ? 'Edit node' : 'Add node'}
            </div>
            <h2 className="mt-0.5 truncate text-base font-semibold text-[var(--color-pib-text)]">
              {isEdit ? node!.name : 'New org chart node'}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--color-pib-text-muted)]">
              {isEdit ? node!.title : 'Add a role or bound agent to the organisation chart'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-pib-ghost btn-pib-sm flex h-8 w-8 shrink-0 items-center justify-center p-0"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="org-node-name" className="pib-label block">Name *</label>
            <input
              id="org-node-name"
              className={inputCls}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Pip"
              aria-label="Name"
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
            />
            <p className="text-[11px] text-[var(--color-pib-text-faint)]">Comma-separated capability keys.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="org-node-default-model" className="pib-label block">Default model</label>
              <select
                id="org-node-default-model"
                className={inputCls}
                value={form.defaultModel}
                onChange={(e) => set('defaultModel', e.target.value)}
                aria-label="Default model"
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
              <label htmlFor="org-node-default-effort" className="pib-label block">Default effort</label>
              <select
                id="org-node-default-effort"
                className={inputCls}
                value={form.defaultEffort}
                onChange={(e) => set('defaultEffort', e.target.value)}
                aria-label="Default effort"
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

          <div className="space-y-2">
            <label htmlFor="org-node-assignable-from" className="pib-label block">Assignable from</label>
            <select
              id="org-node-assignable-from"
              className={inputCls}
              value={form.assignableFrom}
              onChange={(e) => set('assignableFrom', e.target.value as OrgAssignableFrom)}
              aria-label="Assignable from"
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
                    onClick={() => set('colorKey', c)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-pib-line)] px-5 py-4">
          <div>
            {isEdit && (
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
            <button
              type="button"
              onClick={onClose}
              disabled={busy !== null}
              className="btn-pib-ghost btn-pib-sm font-label disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy !== null}
              className="btn-pib-primary btn-pib-sm font-label disabled:opacity-50"
              aria-label={isEdit ? 'Save node' : 'Create node'}
            >
              {busy === 'save' ? 'Saving…' : isEdit ? 'Save changes' : 'Create node'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
