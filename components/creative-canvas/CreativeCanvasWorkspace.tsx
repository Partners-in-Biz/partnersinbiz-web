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
  CreativeCanvasNode,
  CreativeCanvasNodeType,
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
  return {
    id: node.id,
    type: 'default',
    position: node.position,
    data: {
      label: (
        <div className="min-w-36">
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

  const activeCanvas = useMemo(
    () => canvases.find((canvas) => canvas.id === activeCanvasId) ?? canvases[0],
    [activeCanvasId, canvases]
  )

  const resolvedOrgId = orgId ?? activeCanvas?.orgId ?? ''

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
  }, [orgId])

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
    } catch {
      setSaveMessage('Graph save failed')
    } finally {
      setSaving(false)
    }
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
          </div>

            <div>
              <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Run history</h3>
              <div className="mt-2 rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
                Runs will appear here after an agent or provider job is queued.
              </div>
            </div>

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
