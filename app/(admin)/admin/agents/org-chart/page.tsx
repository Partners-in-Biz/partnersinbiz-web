'use client'

/**
 * Agent Org Chart — admin page for the AgentOrgNode org-chart subsystem.
 *
 * Reads ?orgId= from the URL (defaults to 'pib-platform-owner'), fetches the
 * chart from GET /api/v1/admin/agent-org and renders the Paperclip-style
 * OrgChartCanvas. Toolbar: org switcher, Seed default chart, Refresh,
 * Fit / Zoom controls (drive the canvas via ref) and Add node.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import OrgChartCanvas, { type OrgChartCanvasHandle } from '@/components/agents/org-chart/OrgChartCanvas'
import OrgNodeEditor from '@/components/agents/org-chart/OrgNodeEditor'
import type { AgentOrgNode, OrgTreeNode } from '@/lib/agent-org/types'

const DEFAULT_ORG_ID = 'pib-platform-owner'

interface FetchResult {
  nodes: AgentOrgNode[]
  tree: OrgTreeNode[]
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ node: AgentOrgNode | null } | null>(null)
  const canvasRef = useRef<OrgChartCanvasHandle>(null)

  const load = useCallback(async (oid: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/agent-org?orgId=${encodeURIComponent(oid)}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.error ?? `Failed to load org chart (${res.status})`)
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
  }, [])

  useEffect(() => {
    load(orgId)
  }, [orgId, load])

  const applyOrg = () => {
    const next = orgInput.trim() || DEFAULT_ORG_ID
    if (next === orgId) {
      load(next)
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

  const handleSaved = () => {
    setEditor(null)
    setNotice(null)
    load(orgId)
  }

  const handleDeleted = () => {
    setEditor(null)
    setNotice(null)
    load(orgId)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        accent="cyan"
        eyebrow="Admin · Agents"
        title="Agent Org Chart"
        description="Paperclip-style organisation chart — who reports to whom, what each role can do, and its runtime defaults."
      />

      {/* Toolbar */}
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
          onClick={handleSeed}
          disabled={seeding || loading}
          className="btn-pib-ghost btn-pib-sm font-label inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
          {seeding ? 'Seeding…' : 'Seed default chart'}
        </button>
        <button
          type="button"
          onClick={() => load(orgId)}
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
          disabled={loading}
          className="btn-pib-primary btn-pib-sm font-label inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Add node
        </button>
      </div>

      {/* Inline notices */}
      {notice && !error && (
        <div className="flex items-center gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300">
          <span className="material-symbols-outlined text-[14px]">info</span>
          {notice}
        </div>
      )}

      {/* Canvas / frames */}
      <div className="relative h-[calc(100vh-320px)] min-h-[480px]">
        <OrgChartCanvas
          ref={canvasRef}
          nodes={nodes}
          tree={tree}
          loading={loading}
          error={error}
          seeding={seeding}
          onSeed={handleSeed}
          onSelectNode={(node) => setEditor({ node })}
        />
      </div>

      <OrgNodeEditor
        open={editor !== null}
        orgId={orgId}
        node={editor?.node ?? null}
        nodes={nodes}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </div>
  )
}
