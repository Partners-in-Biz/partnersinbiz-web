'use client'

/**
 * Agent Org Chart — admin page for the AgentOrgNode org-chart subsystem.
 *
 * Reads ?orgId= from the URL (defaults to 'pib-platform-owner'), fetches the
 * chart from GET /api/v1/admin/agent-org and live agent runtime labels from
 * GET /api/v1/admin/agents. Toolbar: org switcher, Seed default chart, Refresh,
 * Fit / Zoom controls (drive the canvas via ref) and Add node.
 *
 * Side drawer:
 * - Org role tab = Firestore task defaults (always)
 * - Live runtime tab = full AgentDetailPanel when node.agentId is bound
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import OrgChartCanvas, { type OrgChartCanvasHandle } from '@/components/agents/org-chart/OrgChartCanvas'
import OrgNodeEditor from '@/components/agents/org-chart/OrgNodeEditor'
import type { AgentTeamDoc } from '@/components/agents/AgentCard'
import type { RuntimeModelSummary } from '@/lib/agents/runtime-config'
import type { AgentOrgNode, OrgTreeNode } from '@/lib/agent-org/types'

const DEFAULT_ORG_ID = 'pib-platform-owner'

type LiveAgent = AgentTeamDoc & { runtimeModel?: RuntimeModelSummary }

interface SessionInfo {
  isSuperAdmin?: boolean
}

interface FetchResult {
  nodes: AgentOrgNode[]
  tree: OrgTreeNode[]
}

function liveModelLabel(agent: LiveAgent | undefined): string | undefined {
  if (!agent) return undefined
  const rm = agent.runtimeModel
  if (rm?.label?.trim()) return rm.label.trim()
  if (rm?.primaryProvider && rm?.primaryModel) return `${rm.primaryProvider} / ${rm.primaryModel}`
  if (agent.defaultModel?.trim()) return agent.defaultModel.trim()
  return undefined
}

export default function AgentOrgChartPage() {
  const [orgId, setOrgId] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_ORG_ID
    const fromUrl = new URLSearchParams(window.location.search).get('orgId')
    return fromUrl && fromUrl.trim() ? fromUrl.trim() : DEFAULT_ORG_ID
  })
  const [orgInput, setOrgInput] = useState<string>(orgId)
  const [nodes, setNodes] = useState<AgentOrgNode[]>([])
  const [tree, setTree] = useState<OrgTreeNode[]>([])
  const [agentsById, setAgentsById] = useState<Record<string, LiveAgent>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ node: AgentOrgNode | null } | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const canvasRef = useRef<OrgChartCanvasHandle>(null)

  const liveModelByAgentId = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [id, agent] of Object.entries(agentsById)) {
      const label = liveModelLabel(agent)
      if (label) out[id] = label
    }
    return out
  }, [agentsById])

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/agents')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return
      const list = (body.data ?? []) as LiveAgent[]
      const map: Record<string, LiveAgent> = {}
      for (const agent of list) {
        if (agent?.agentId) map[agent.agentId] = agent
      }
      setAgentsById(map)
    } catch {
      // Live labels are best-effort; chart still works from Firestore defaults.
    }
  }, [])

  const load = useCallback(async (oid: string) => {
    setLoading(true)
    setError(null)
    try {
      const [chartRes] = await Promise.all([
        fetch(`/api/v1/admin/agent-org?orgId=${encodeURIComponent(oid)}`),
        loadAgents(),
      ])
      const body = await chartRes.json().catch(() => ({}))
      if (!chartRes.ok) {
        throw new Error(body?.error ?? `Failed to load org chart (${chartRes.status})`)
      }
      const data = (body.data ?? {}) as Partial<FetchResult>
      setNodes(data.nodes ?? [])
      setTree(data.tree ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load org chart')
      setNodes([])
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [loadAgents])

  useEffect(() => {
    void load(orgId)
  }, [orgId, load])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((res) => (res.ok ? res.json() : null))
      .then((session: SessionInfo | null) => {
        if (!cancelled) setIsSuperAdmin(Boolean(session?.isSuperAdmin))
      })
      .catch(() => {
        if (!cancelled) setIsSuperAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const applyOrg = () => {
    const next = orgInput.trim() || DEFAULT_ORG_ID
    if (next === orgId) {
      void load(next)
      return
    }
    setOrgId(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('orgId', next)
      window.history.replaceState(null, '', url.toString())
    }
  }

  const handleSeed = async () => {
    setSeeding(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/admin/agent-org/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.error ?? `Seed failed (${res.status})`)
      }
      const created = body.data?.created ?? 0
      setNotice(
        body.data?.skipped
          ? `Chart already exists — ${created} nodes present.`
          : `Seeded ${created} nodes.`,
      )
      await load(orgId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed')
    } finally {
      setSeeding(false)
    }
  }

  const handleSaved = (saved: AgentOrgNode | null) => {
    setEditor(null)
    setNotice(
      saved?.agentId
        ? `Saved ${saved.name}. Use Live runtime tab (or tick sync) to push model onto linked machines.`
        : null,
    )
    void load(orgId)
  }

  const handleDeleted = () => {
    setEditor(null)
    setNotice(null)
    void load(orgId)
  }

  const handleRuntimeSaved = (agent: AgentTeamDoc) => {
    setAgentsById((prev) => ({
      ...prev,
      [agent.agentId]: { ...(prev[agent.agentId] ?? agent), ...agent },
    }))
    void loadAgents()
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        accent="cyan"
        eyebrow="Admin · Agents"
        title="Agent Org Chart"
        description="Hierarchy + task defaults (Firestore) with the same live Hermes runtime panel as /admin/agents when a node is bound. Cyan chips = live machine model."
      />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2.5">
        <label
          htmlFor="agent-org-org-id"
          className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-faint)]"
        >
          Org
        </label>
        <input
          id="agent-org-org-id"
          className="pib-input h-8 w-52"
          value={orgInput}
          onChange={(e) => setOrgInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyOrg()
          }}
          placeholder={DEFAULT_ORG_ID}
          aria-label="Organisation id"
        />
        <button type="button" onClick={applyOrg} className="btn-pib-ghost btn-pib-sm font-label">
          Load
        </button>

        <div className="mx-1 h-5 w-px bg-[var(--color-pib-line)]" />

        <button
          type="button"
          onClick={() => void handleSeed()}
          disabled={seeding || loading || !isSuperAdmin}
          className="btn-pib-ghost btn-pib-sm font-label inline-flex items-center gap-1.5 disabled:opacity-50"
          title={!isSuperAdmin ? 'Super admin required' : undefined}
        >
          <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
          {seeding ? 'Seeding…' : 'Seed default chart'}
        </button>
        <button
          type="button"
          onClick={() => void load(orgId)}
          disabled={loading}
          className="btn-pib-ghost btn-pib-sm font-label inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>

        <div className="mx-1 h-5 w-px bg-[var(--color-pib-line)]" />

        <button
          type="button"
          onClick={() => canvasRef.current?.zoomOut()}
          className="btn-pib-ghost btn-pib-sm font-label inline-flex items-center gap-1"
          aria-label="Zoom out"
        >
          <span className="material-symbols-outlined text-[16px]">zoom_out</span>
        </button>
        <button
          type="button"
          onClick={() => canvasRef.current?.fit()}
          className="btn-pib-ghost btn-pib-sm font-label inline-flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">fit_screen</span>
          Fit
        </button>
        <button
          type="button"
          onClick={() => canvasRef.current?.zoomIn()}
          className="btn-pib-ghost btn-pib-sm font-label inline-flex items-center gap-1"
          aria-label="Zoom in"
        >
          <span className="material-symbols-outlined text-[16px]">zoom_in</span>
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setEditor({ node: null })}
          disabled={loading || !isSuperAdmin}
          className="btn-pib-primary btn-pib-sm font-label inline-flex items-center gap-1.5 disabled:opacity-50"
          title={!isSuperAdmin ? 'Super admin required' : undefined}
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Add node
        </button>
      </div>

      {!isSuperAdmin && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          View-only — super admin is required to edit org roles or live runtime profiles.
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
      </div>

      <OrgNodeEditor
        open={editor !== null}
        orgId={orgId}
        node={editor?.node ?? null}
        nodes={nodes}
        canEdit={isSuperAdmin}
        agentsById={agentsById}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        onRuntimeSaved={handleRuntimeSaved}
      />
    </div>
  )
}
