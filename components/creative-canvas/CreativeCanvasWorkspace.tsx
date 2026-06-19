'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import type {
  CreativeCanvas,
  CreativeCanvasEdge,
  CreativeCanvasExport,
  CreativeCanvasNode,
  CreativeCanvasNodeType,
  CreativeCanvasVersion,
} from '@/lib/creative-canvas/types'

type CreativeCanvasMode = 'admin' | 'portal'

interface CreativeCanvasWorkspaceProps {
  mode: CreativeCanvasMode
  orgId?: string
}

interface CreativeCanvasApiListResponse {
  success?: boolean
  data?: {
    canvases?: CreativeCanvas[]
  }
}

interface CreativeCanvasVersionApiResponse {
  success?: boolean
  data?: {
    versions?: Array<CreativeCanvasVersion & { id?: string }>
  }
}

const nodeTypeLabels: Record<CreativeCanvasNodeType, string> = {
  source: 'Source',
  brief: 'Brief',
  prompt: 'Prompt',
  model: 'Model',
  edit: 'Edit',
  review: 'Review',
  output: 'Output',
}

const palette: Array<{ type: CreativeCanvasNodeType; label: string; description: string }> = [
  { type: 'source', label: 'Source', description: 'Brand assets, uploads, research, URLs' },
  { type: 'prompt', label: 'Prompt', description: 'Generation brief, style, and constraints' },
  { type: 'model', label: 'Model', description: 'Higgsfield or agent-backed generation' },
  { type: 'review', label: 'Review', description: 'Brand, rights, and approval gate' },
  { type: 'output', label: 'Output', description: 'Draft image, video, copy, blog, book asset' },
]

function toFlowNode(node: CreativeCanvasNode): Node {
  const previewUrl = node.source?.thumbnailUrl ?? node.source?.previewUrl ?? node.output?.thumbnailUrl ?? node.output?.url
  return {
    id: node.id,
    type: 'default',
    position: node.position,
    data: {
      label: (
        <div className="min-w-36">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`Reference preview: ${node.source?.altText ?? node.title}`}
              className="mb-2 h-20 w-full rounded-md object-cover"
            />
          ) : null}
          <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">
            {nodeTypeLabels[node.type]}
          </p>
          <p className="text-sm font-semibold text-[var(--color-pib-text)]">{node.title}</p>
        </div>
      ),
      canvasNode: node,
    },
  }
}

function toCanvasNode(node: Node, orgId: string): CreativeCanvasNode {
  const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
  return {
    id: node.id,
    orgId,
    type: canvasNode?.type ?? 'source',
    title: canvasNode?.title ?? node.id,
    position: node.position,
    data: canvasNode?.data ?? {},
    source: canvasNode?.source,
    provider: canvasNode?.provider,
    review: canvasNode?.review,
    output: canvasNode?.output,
  }
}

function toFlowEdge(edge: CreativeCanvasEdge): Edge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.label,
    data: edge.data,
  }
}

function toCanvasEdge(edge: Edge, orgId: string): CreativeCanvasEdge {
  return {
    id: edge.id,
    orgId,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    label: typeof edge.label === 'string' ? edge.label : undefined,
    data: typeof edge.data === 'object' && edge.data ? edge.data : undefined,
  }
}

export function CreativeCanvasWorkspace({ mode, orgId }: CreativeCanvasWorkspaceProps) {
  const [canvases, setCanvases] = useState<CreativeCanvas[]>([])
  const [activeCanvasId, setActiveCanvasId] = useState<string>('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [versions, setVersions] = useState<Array<CreativeCanvasVersion & { id?: string }>>([])
  const [commentBody, setCommentBody] = useState('')
  const [activityMessage, setActivityMessage] = useState('')
  const [exportTarget, setExportTarget] = useState<CreativeCanvasExport['target']>('campaign_asset')
  const [latestRun, setLatestRun] = useState<{ id: string; status: string; nodeId?: string } | null>(null)

  const activeCanvas = useMemo(
    () => canvases.find((canvas) => canvas.id === activeCanvasId) ?? canvases[0],
    [activeCanvasId, canvases]
  )

  const resolvedOrgId = orgId ?? activeCanvas?.orgId ?? ''
  const selectedCanvasNode = useMemo(() => {
    const flowNode = nodes[0]
    return flowNode?.data?.canvasNode as CreativeCanvasNode | undefined
  }, [nodes])

  const selectedNodeId = selectedCanvasNode?.id

  const loadVersions = useCallback(async (canvasId: string, canvasOrgId: string) => {
    if (!canvasId || !canvasOrgId) {
      setVersions([])
      return
    }

    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/versions?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasVersionApiResponse
    setVersions(payload.data?.versions ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadCanvases = async () => {
      setLoading(true)
      setError('')

      try {
        const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
        const response = await fetch(`/api/v1/creative-canvas${query}`)
        const payload = (await response.json()) as CreativeCanvasApiListResponse
        const loadedCanvases = payload.data?.canvases ?? []

        if (cancelled) return

        setCanvases(loadedCanvases)
        const firstCanvas = loadedCanvases[0]
        setActiveCanvasId(firstCanvas?.id ?? '')
        setNodes((firstCanvas?.nodes ?? []).map(toFlowNode))
        setEdges((firstCanvas?.edges ?? []).map(toFlowEdge))
        if (firstCanvas?.id) {
          await loadVersions(firstCanvas.id, orgId ?? firstCanvas.orgId)
        } else {
          setVersions([])
        }
      } catch {
        if (!cancelled) {
          setError('Creative Canvas could not load.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadCanvases()

    return () => {
      cancelled = true
    }
  }, [loadVersions, orgId])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => addEdge(connection, currentEdges))
  }, [])

  const addCanvasNode = (type: CreativeCanvasNodeType) => {
    const nextNumber = nodes.length + 1
    const title = `${nodeTypeLabels[type]} node`
    const id = `${type}-node-${Date.now()}`
    const canvasNode: CreativeCanvasNode = {
      id,
      orgId: resolvedOrgId || 'pending-org',
      type,
      title,
      position: { x: 80 + nextNumber * 40, y: 90 + nextNumber * 28 },
      data: { createdFrom: 'creative_canvas_palette' },
      source: type === 'source'
        ? {
            kind: 'upload',
            referenceRole: 'general',
            weight: 1,
            altText: title,
          }
        : undefined,
      review: type === 'review'
        ? {
            status: 'needed',
            syntheticMediaDisclosure: true,
            rightsStatus: 'needs_review',
            brandStatus: 'needs_review',
          }
        : undefined,
    }

    setNodes((currentNodes) => [...currentNodes, toFlowNode(canvasNode)])
    setSaveMessage('')
  }

  const saveGraph = async () => {
    if (!activeCanvas?.id) return

    setSaving(true)
    setSaveMessage('')

    try {
      const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
      const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/graph${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas.orgId)),
          edges: edges.map((edge) => toCanvasEdge(edge, resolvedOrgId || activeCanvas.orgId)),
        }),
      })

      if (!response.ok) {
        throw new Error('Save failed')
      }

      setSaveMessage('Graph saved')
      await loadVersions(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
    } catch {
      setSaveMessage('Graph save failed')
    } finally {
      setSaving(false)
    }
  }

  const postComment = async () => {
    if (!activeCanvas?.id || !commentBody.trim()) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/comments${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: selectedNodeId,
        body: commentBody,
        visibility: mode === 'portal' ? 'admin_agents_clients' : 'admin_agents',
      }),
    })

    if (response.ok) {
      setActivityMessage('Comment added')
      setCommentBody('')
    } else {
      setActivityMessage('Comment failed')
    }
  }

  const attachSampleOutput = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/nodes/${selectedNodeId}/output${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'image',
        textPreview: 'Review-ready creative output',
        review: {
          status: 'needed',
          rightsStatus: 'needs_review',
          brandStatus: 'needs_review',
          syntheticMediaDisclosure: true,
        },
      }),
    })
    setActivityMessage(response.ok ? 'Output attached for review' : 'Output attach failed')
  }

  const markReviewPassed = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/nodes/${selectedNodeId}/review${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'passed',
        rightsStatus: 'cleared',
        brandStatus: 'passed',
        syntheticMediaDisclosure: true,
      }),
    })
    setActivityMessage(response.ok ? 'Review gate passed' : 'Review update failed')
  }

  const queueRun = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canvasId: activeCanvas.id,
        nodeId: selectedNodeId,
        providerKey: 'higgsfield',
        input: {
          promptSummary: 'Generate a reviewable creative asset from the active canvas node.',
          sourceNodeIds: selectedNodeId ? [selectedNodeId] : [],
          sourceArtifactIds: [],
          format: 'internal_draft',
        },
      }),
    })
    if (!response.ok) {
      setActivityMessage('Run queue failed')
      return
    }
    const payload = await response.json().catch(() => null) as { data?: { run?: { id?: string; status?: string; nodeId?: string } } } | null
    const run = payload?.data?.run
    if (run?.id) {
      setLatestRun({ id: run.id, status: run.status ?? 'queued', nodeId: run.nodeId })
      setActivityMessage(`Run queued: ${run.id}`)
    } else {
      setActivityMessage('Run queued for agent review')
    }
  }

  const ingestRunOutput = async () => {
    if (!activeCanvas?.id || !latestRun?.id) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs/${latestRun.id}/complete${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outputNodeId: `${latestRun.nodeId ?? selectedNodeId ?? 'run'}-output`,
        output: {
          kind: 'image',
          textPreview: 'Provider output ready for review',
        },
        provenance: {
          costLabel: 'provider_reported',
        },
      }),
    })
    if (response.ok) {
      setLatestRun((current) => current ? { ...current, status: 'completed' } : current)
      setActivityMessage(`Run completed: ${latestRun.id}`)
    } else {
      setActivityMessage('Run output ingest failed')
    }
  }

  const exportDraft = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/exports/draft${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: selectedNodeId,
        target: exportTarget,
      }),
    })
    setActivityMessage(response.ok ? 'Draft export prepared' : 'Draft export failed')
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <div className="pib-skeleton h-[520px]" />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{mode === 'admin' ? 'Agent creative command' : 'Creative review'}</p>
          <h1 className="text-3xl font-headline font-bold text-[var(--color-pib-text)]">Creative Canvas</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
            Plan, generate, review, and export social posts, blogs, videos, books, and campaign assets from one agent-aware graph.
          </p>
        </div>
        <button
          type="button"
          onClick={saveGraph}
          disabled={!activeCanvas?.id || saving}
          className="rounded-lg bg-[var(--color-pib-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving graph' : 'Save graph'}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid min-h-[620px] gap-4 lg:grid-cols-[260px_minmax(0,1fr)_280px]">
        <aside className="space-y-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Canvases</p>
            <div className="mt-3 space-y-2">
              {canvases.map((canvas) => (
                <button
                  key={canvas.id}
                  type="button"
                  aria-label={`Open ${canvas.title}`}
                  onClick={() => {
                    setActiveCanvasId(canvas.id ?? '')
                    setNodes(canvas.nodes.map(toFlowNode))
                    setEdges(canvas.edges.map(toFlowEdge))
                  }}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left text-sm text-[var(--color-pib-text)] transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block font-semibold">Canvas: {canvas.title}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{canvas.purpose}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Palette</p>
            <div className="mt-3 space-y-2">
              {palette.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  aria-label={`Add ${item.type} node`}
                  onClick={() => addCanvasNode(item.type)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{item.label}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{item.description}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-white">
          <div className="flex items-center justify-between border-b border-[var(--color-pib-line)] px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">{activeCanvas?.title ?? 'Untitled canvas'}</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                {nodes.length} nodes / {edges.length} links / v{activeCanvas?.activeVersion ?? 1}
              </p>
            </div>
            {saveMessage ? <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">{saveMessage}</p> : null}
          </div>
          <div className="h-[560px]">
            <ReactFlow nodes={nodes} edges={edges} onConnect={onConnect} fitView>
              <Background />
              <Controls />
              <MiniMap />
            </ReactFlow>
          </div>
        </section>

        <aside className="space-y-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Inspector</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">
              {activeCanvas ? `Selected: ${activeCanvas.title}` : 'No canvas selected'}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
              {activeCanvas?.purpose ?? 'Create a canvas to start an agent-assisted creative workflow.'}
            </p>
          </div>

          <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Agent controls</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Queue Higgsfield, copy, document, and review work from prompt/model nodes while keeping approval gates intact.
            </p>
            {mode === 'admin' ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={queueRun}
                  disabled={!selectedNodeId}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Queue run
                </button>
                <button
                  type="button"
                  onClick={ingestRunOutput}
                  disabled={!latestRun?.id}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ingest run output
                </button>
              </div>
            ) : null}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Run history</h3>
            <div className="mt-2 rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
              Runs will appear here after an agent or provider job is queued.
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Versions</h3>
            <div className="mt-2 space-y-2">
              {versions.length ? versions.map((version) => (
                <div
                  key={version.id ?? version.version}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]"
                >
                  <span className="font-semibold text-[var(--color-pib-text)]">Version {version.version}</span>
                  <span className="block">{version.reason ?? 'graph snapshot'}</span>
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Saved graph snapshots will appear here.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Comments</h3>
            <label className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-comment">
              Comment body
            </label>
            <textarea
              id="creative-canvas-comment"
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-sm text-[var(--color-pib-text)]"
              placeholder="Add a note for agents, reviewers, or the client"
            />
            <button
              type="button"
              onClick={postComment}
              disabled={!activeCanvas?.id || !commentBody.trim()}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add comment
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Output attachment</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Attach generated media, copy, blog blocks, book artifacts, or campaign assets back onto the selected node.
            </p>
            <button
              type="button"
              onClick={attachSampleOutput}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Attach output
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Review gate</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Rights, brand, and synthetic-media disclosure must pass before client-visible or downstream export use.
            </p>
            <button
              type="button"
              onClick={markReviewPassed}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Mark review passed
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Exports</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Draft adapters route reviewed outputs into social, documents, campaigns, YouTube Studio, Book Studio, and artifacts.
            </p>
            <label className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-export-target">
              Export target
            </label>
            <select
              id="creative-canvas-export-target"
              value={exportTarget}
              onChange={(event) => setExportTarget(event.target.value as CreativeCanvasExport['target'])}
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text)]"
            >
              <option value="campaign_asset">Campaign asset</option>
              <option value="social_draft">Social draft</option>
              <option value="client_document">Client document / blog</option>
              <option value="research">Research</option>
              <option value="youtube_studio">YouTube Studio</option>
              <option value="book_studio">Book Studio</option>
              <option value="workspace_artifact">Workspace artifact</option>
            </select>
            <button
              type="button"
              onClick={exportDraft}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prepare draft export
            </button>
          </div>

          {activityMessage ? (
            <p className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
              {activityMessage}
            </p>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Nodes</h3>
            <div className="mt-2 space-y-2">
              {nodes.length ? nodes.map((node) => {
                const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined

                return (
                  <div
                    key={node.id}
                    className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]"
                  >
                    <span className="block font-semibold text-[var(--color-pib-text)]">
                      {canvasNode?.title ?? node.id}
                    </span>
                    <span>{canvasNode?.type ?? 'source'}</span>
                    {canvasNode?.source?.referenceRole ? (
                      <span className="ml-2">
                        {canvasNode.source.referenceRole} / {canvasNode.source.weight ?? 1}
                      </span>
                    ) : null}
                    {canvasNode?.source?.thumbnailUrl || canvasNode?.source?.previewUrl ? (
                      <img
                        src={canvasNode.source.thumbnailUrl ?? canvasNode.source.previewUrl}
                        alt={`Reference preview: ${canvasNode.source.altText ?? canvasNode.title}`}
                        className="mt-2 h-24 w-full rounded-md object-cover"
                      />
                    ) : null}
                  </div>
                )
              }) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Add source material, prompts, models, reviews, and outputs from the palette.
                </p>
              )}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
