'use client'

/**
 * Shared Agent Org Chart surface for:
 * - Admin: /admin/agents/org-chart (org picker + superadmin runtime tab)
 * - Portal: /portal/settings/agents/org-chart (active org auto-selected)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentOrgNode, OrgTreeNode } from '@/lib/agent-org/types'
import type { AgentTeamDoc } from '@/components/agents/AgentCard'
import type { RuntimeModelSummary } from '@/lib/agents/runtime-config'
import OrgChartCanvas, { type OrgChartCanvasHandle } from '@/components/agents/org-chart/OrgChartCanvas'
import OrgNodeEditor from '@/components/agents/org-chart/OrgNodeEditor'

export type AgentOrgChartMode = 'admin' | 'portal'

export interface AgentOrgChartClientProps {
  mode: AgentOrgChartMode
  /**
   * Admin: initial org from query or default platform owner.
   * Portal: active org id (locked).
   */
  orgId: string
  /** Admin only — when set, shows org switcher control. */
  orgOptions?: Array<{ id: string; name: string }>
  onOrgChange?: (orgId: string) => void
  /** Human label for the locked portal org. */
  orgLabel?: string
  canEdit: boolean
  /**
   * Chart CRUD base:
   * admin  → /api/v1/admin/agent-org
   * portal → /api/v1/portal/settings/agents/org-chart
   */
  apiBase: string
  /** List endpoint that returns agents for live chips. */
  agentsListUrl: string
  /** Optional seed template override. */
  seedTemplate?: 'platform' | 'minimal'
  allowRuntimeTab?: boolean
  allowLiveRuntimeSync?: boolean
  readOnlyMessage?: string
  title?: string
  description?: string
}

type LiveAgent = AgentTeamDoc & { runtimeModel?: RuntimeModelSummary; defaultModel?: string }

function liveLabel(agent: LiveAgent | undefined): string | undefined {
  if (!agent) return undefined
  const rm = agent.runtimeModel
  if (typeof rm?.label === 'string' && rm.label.trim()) {
    return rm.label.trim()
  }
  if (rm?.primaryModel) {
    const provider = rm.primaryProvider ? `${rm.primaryProvider}/` : ''
    return `${provider}${rm.primaryModel}`
  }
  if (typeof agent.defaultModel === 'string' && agent.defaultModel.trim()) {
    return agent.defaultModel.trim()
  }
  return undefined
}

export default function AgentOrgChartClient({
  mode,
  orgId,
  orgOptions,
  onOrgChange,
  orgLabel,
  canEdit,
  apiBase,
  agentsListUrl,
  seedTemplate,
  allowRuntimeTab = mode === 'admin',
  allowLiveRuntimeSync = mode === 'admin',
  readOnlyMessage =
    mode === 'admin'
      ? 'Only super admins can edit org roles or live runtime profiles.'
      : 'Only organisation owners/admins can edit the agent org chart.',
  title = 'Agent org chart',
  description =
    'Hierarchy of org roles. Bound agentIds run on linked machines; unbound seats are organisational only until hired.',
}: AgentOrgChartClientProps) {
  const canvasRef = useRef<OrgChartCanvasHandle>(null)
  const [nodes, setNodes] = useState<AgentOrgNode[]>([])
  const [tree, setTree] = useState<OrgTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ node: AgentOrgNode | null } | null>(null)
  const [agentsById, setAgentsById] = useState<Record<string, LiveAgent>>({})

  const chartUrl = useCallback(() => {
    if (mode === 'admin') {
      const qs = new URLSearchParams({ orgId })
      return `${apiBase}?${qs.toString()}`
    }
    return apiBase
  }, [apiBase, mode, orgId])

  const seedUrl = useCallback(() => `${apiBase}/seed`, [apiBase])

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch(agentsListUrl)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return
      const list =
        (body.data?.agents as LiveAgent[] | undefined) ??
        (body.agents as LiveAgent[] | undefined) ??
        (Array.isArray(body.data) ? (body.data as LiveAgent[]) : [])
      const map: Record<string, LiveAgent> = {}
      for (const a of list) {
        if (a?.agentId) map[a.agentId] = a
      }
      setAgentsById(map)
    } catch {
      // live chips optional — keep previous map rather than fail the chart
      void 0
    }
  }, [agentsListUrl])

  const loadChart = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(chartUrl())
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? `Failed to load org chart (${res.status})`)
      const data = body.data ?? body
      setNodes((data.nodes as AgentOrgNode[]) ?? [])
      setTree((data.tree as OrgTreeNode[]) ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load org chart')
      setNodes([])
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [chartUrl])

  useEffect(() => {
    void loadChart()
    void loadAgents()
  }, [loadChart, loadAgents])

  const liveModelByAgentId = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [id, agent] of Object.entries(agentsById)) {
      const label = liveLabel(agent)
      if (label) out[id] = label
    }
    return out
  }, [agentsById])

  const handleSeed = async () => {
    if (!canEdit) return
    setSeeding(true)
    setError(null)
    setNotice(null)
    try {
      const template =
        seedTemplate ?? (orgId === 'pib-platform-owner' ? 'platform' : 'minimal')
      const res = await fetch(seedUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'admin' ? { orgId, template } : { template }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? `Seed failed (${res.status})`)
      const data = body.data ?? body
      if (data.skipped) {
        setNotice('Chart already has nodes — seed skipped (idempotent).')
      } else {
        setNotice(`Seeded ${data.created ?? 0} role seat(s) (${template} template).`)
      }
      await loadChart()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed')
    } finally {
      setSeeding(false)
    }
  }

  const handleSaved = (node: AgentOrgNode | null) => {
    setEditor(null)
    setNotice(node ? `Saved ${node.name}.` : 'Saved.')
    void loadChart()
  }

  const handleDeleted = () => {
    setEditor(null)
    setNotice('Role deleted.')
    void loadChart()
  }

  const handleRuntimeSaved = (agent: AgentTeamDoc) => {
    setAgentsById((prev) => ({
      ...prev,
      [agent.agentId]: { ...prev[agent.agentId], ...agent },
    }))
    void loadAgents()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--color-pib-text)]">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">{description}</p>
          {mode === 'portal' && (
            <p className="mt-1 text-xs text-[var(--color-pib-text-faint)]">
              Organisation:{' '}
              <span className="text-[var(--color-pib-text-muted)]">
                {orgLabel ?? orgId}
              </span>{' '}
              (auto-selected from your active workspace)
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'admin' && orgOptions && orgOptions.length > 0 && onOrgChange ? (
            <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
              <span className="sr-only" id="agent-org-org-id-label">
                Organisation
              </span>
              <select
                id="agent-org-org-id"
                aria-labelledby="agent-org-org-id-label"
                className="pib-input max-w-[220px] text-sm"
                value={orgId}
                onChange={(e) => onOrgChange(e.target.value)}
              >
                {orgOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            type="button"
            onClick={() => void loadChart()}
            disabled={loading}
            className="btn-pib-ghost btn-pib-sm font-label inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void handleSeed()}
            disabled={loading || seeding || !canEdit || nodes.length > 0}
            className="btn-pib-ghost btn-pib-sm font-label inline-flex items-center gap-1.5 disabled:opacity-50"
            title={
              !canEdit
                ? 'Admin required'
                : nodes.length > 0
                  ? 'Chart already seeded'
                  : 'Seed starter seats'
            }
          >
            <span className="material-symbols-outlined text-[16px]">park</span>
            {seeding ? 'Seeding…' : 'Seed starter chart'}
          </button>

          <button
            type="button"
            onClick={() => setEditor({ node: null })}
            disabled={loading || !canEdit}
            className="btn-pib-primary btn-pib-sm font-label inline-flex items-center gap-1.5 disabled:opacity-50"
            title={!canEdit ? 'Admin required' : undefined}
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add node
          </button>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          View-only — {readOnlyMessage}
        </div>
      )}

      {notice && !error && (
        <div className="flex items-center gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300">
          <span className="material-symbols-outlined text-[14px]">info</span>
          {notice}
        </div>
      )}

      <div className="relative h-[calc(100vh-320px)] min-h-[480px]">
        <OrgChartCanvas
          ref={canvasRef}
          nodes={nodes}
          tree={tree}
          loading={loading}
          error={error}
          seeding={seeding}
          onSeed={() => void handleSeed()}
          onSelectNode={(node) => setEditor({ node })}
          liveModelByAgentId={liveModelByAgentId}
        />
        <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] shadow-lg">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => canvasRef.current?.zoomOut()}
            className="grid h-8 w-8 place-items-center border-r border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">remove</span>
          </button>
          <button
            type="button"
            aria-label="Fit chart"
            title="Fit chart"
            onClick={() => canvasRef.current?.fit()}
            className="grid h-8 w-8 place-items-center border-r border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">fit_screen</span>
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => canvasRef.current?.zoomIn()}
            className="grid h-8 w-8 place-items-center text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>
          </button>
        </div>
      </div>

      <OrgNodeEditor
        open={editor !== null}
        orgId={orgId}
        node={editor?.node ?? null}
        nodes={nodes}
        canEdit={canEdit}
        agentsById={agentsById}
        apiBase={apiBase}
        allowRuntimeTab={allowRuntimeTab}
        allowLiveRuntimeSync={allowLiveRuntimeSync}
        readOnlyMessage={readOnlyMessage}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        onRuntimeSaved={handleRuntimeSaved}
      />
    </div>
  )
}
