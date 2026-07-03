'use client'

// components/creative-canvas/portal/CanvasReviewPanel.tsx
//
// Client-portal review surface for a creative canvas: lists reviewable nodes
// (anything with a generated output or text content) as cards with
// Approve / Request changes actions. Decisions PUT to
// /api/v1/creative-canvas/[id]/nodes/[nodeId]/review with
// { action, note? } and update the chip optimistically.

import { useEffect, useMemo, useState } from 'react'

export interface CanvasReviewPanelNode {
  id: string
  title?: string
  type?: string
  review?: {
    status?: string
    clientNote?: string
  }
  output?: {
    kind?: string
    url?: string
    thumbnailUrl?: string
    textPreview?: string
  }
  data?: Record<string, unknown>
}

export interface CanvasReviewPanelProps {
  canvasId: string
  orgId?: string
  nodes: CanvasReviewPanelNode[]
  onReviewed?: (nodeId: string, action: 'approve' | 'request_changes') => void
}

type ReviewChipState = {
  label: string
  tone: 'approved' | 'changes' | 'pending'
}

function nodeTextSnippet(node: CanvasReviewPanelNode): string | undefined {
  if (node.output?.textPreview) return node.output.textPreview
  const text = node.data?.text
  if (typeof text === 'string' && text.trim()) return text.trim()
  return undefined
}

function isReviewable(node: CanvasReviewPanelNode): boolean {
  return Boolean(node.output?.url || node.output?.textPreview || nodeTextSnippet(node))
}

function persistedClientReview(node: CanvasReviewPanelNode): { action?: string; note?: string } {
  const record = node.data?.clientReview
  if (!record || typeof record !== 'object') return {}
  const { action, note } = record as Record<string, unknown>
  return {
    action: typeof action === 'string' ? action : undefined,
    note: typeof note === 'string' ? note : undefined,
  }
}

function initialChip(node: CanvasReviewPanelNode): ReviewChipState {
  const persisted = persistedClientReview(node)
  if (persisted.action === 'approve') return { label: 'Approved', tone: 'approved' }
  if (persisted.action === 'request_changes') return { label: 'Changes requested', tone: 'changes' }
  if (node.review?.status === 'passed') return { label: 'Approved', tone: 'approved' }
  if (node.review?.status === 'blocked') return { label: 'Blocked', tone: 'changes' }
  return { label: 'Awaiting review', tone: 'pending' }
}

const CHIP_CLASSES: Record<ReviewChipState['tone'], string> = {
  approved: 'bg-emerald-500/15 text-emerald-500',
  changes: 'bg-amber-500/15 text-amber-500',
  pending: 'bg-surface text-on-surface-variant',
}

export function CanvasReviewPanel({ canvasId, orgId, nodes, onReviewed }: CanvasReviewPanelProps) {
  const reviewable = useMemo(() => nodes.filter(isReviewable), [nodes])
  const [chips, setChips] = useState<Record<string, ReviewChipState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<string | null>(null)

  useEffect(() => {
    setChips(Object.fromEntries(reviewable.map((node) => [node.id, initialChip(node)])))
  }, [reviewable])

  const submitReview = async (nodeId: string, action: 'approve' | 'request_changes') => {
    const previous = chips[nodeId]
    const note = action === 'request_changes' ? (noteDrafts[nodeId] ?? '').trim() : ''

    // Optimistic chip update.
    setChips((current) => ({
      ...current,
      [nodeId]: action === 'approve'
        ? { label: 'Approved', tone: 'approved' }
        : { label: 'Changes requested', tone: 'changes' },
    }))
    setErrors((current) => ({ ...current, [nodeId]: '' }))
    setSubmitting(nodeId)

    try {
      const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
      const response = await fetch(`/api/v1/creative-canvas/${canvasId}/nodes/${nodeId}/review${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'request_changes' && note ? { action, note } : { action }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Review update failed')
      }
      setNoteOpenFor((current) => (current === nodeId ? null : current))
      onReviewed?.(nodeId, action)
    } catch (error) {
      setChips((current) => ({ ...current, [nodeId]: previous ?? { label: 'Awaiting review', tone: 'pending' } }))
      setErrors((current) => ({
        ...current,
        [nodeId]: error instanceof Error ? error.message : 'Review update failed',
      }))
    } finally {
      setSubmitting(null)
    }
  }

  if (!reviewable.length) {
    return (
      <div className="rounded-xl bg-surface-container p-4">
        <h3 className="text-sm font-medium text-on-surface mb-1">Review &amp; approve</h3>
        <p className="text-on-surface-variant text-xs">Nothing is ready for review yet. Check back once your team shares creative output.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-surface-container p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-on-surface">Review &amp; approve</h3>
        <span className="text-xs text-on-surface-variant">{reviewable.length} item{reviewable.length === 1 ? '' : 's'}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reviewable.map((node) => {
          const chip = chips[node.id] ?? initialChip(node)
          const snippet = nodeTextSnippet(node)
          const imageUrl = node.output?.thumbnailUrl || (node.output?.kind !== 'text' ? node.output?.url : undefined)
          const noteOpen = noteOpenFor === node.id
          const busy = submitting === node.id
          const persistedNote = node.review?.clientNote || persistedClientReview(node).note

          return (
            <div key={node.id} data-testid={`review-card-${node.id}`} className="bg-surface rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-on-surface truncate" title={node.title || node.id}>
                  {node.title || node.id}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${CHIP_CLASSES[chip.tone]}`}>
                  {chip.label}
                </span>
              </div>

              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt={node.title || 'Creative output'}
                  className="h-32 w-full rounded-md object-cover bg-surface-container"
                />
              ) : snippet ? (
                <p className="text-xs text-on-surface-variant line-clamp-4 whitespace-pre-wrap">{snippet}</p>
              ) : null}

              {persistedNote && !noteOpen && (
                <p className="text-[11px] text-on-surface-variant italic">Note: {persistedNote}</p>
              )}

              {noteOpen && (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={noteDrafts[node.id] ?? ''}
                    onChange={(event) => setNoteDrafts((current) => ({ ...current, [node.id]: event.target.value }))}
                    maxLength={1000}
                    rows={3}
                    placeholder="What should change?"
                    aria-label={`Change request note for ${node.title || node.id}`}
                    className="w-full rounded-md bg-surface-container p-2 text-xs text-on-surface placeholder:text-on-surface-variant outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitReview(node.id, 'request_changes')}
                      className="rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-500 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Send request
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setNoteOpenFor(null)}
                      className="rounded-full px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!noteOpen && (
                <div className="mt-auto flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitReview(node.id, 'approve')}
                    className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-500 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setNoteOpenFor(node.id)
                      setErrors((current) => ({ ...current, [node.id]: '' }))
                    }}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container"
                  >
                    Request changes
                  </button>
                </div>
              )}

              {errors[node.id] ? (
                <p role="alert" className="text-[11px] text-red-500">{errors[node.id]}</p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Self-fetching wrapper for the portal page. The portal creative-canvas page
// renders the workspace client-side (no server-side canvas fetch), so this
// wrapper loads the client-visible canvases itself and mounts the panel.
// ---------------------------------------------------------------------------

interface CanvasSummary {
  id: string
  title?: string
  visibility?: string
  deleted?: boolean
  nodes?: CanvasReviewPanelNode[]
}

export function PortalCanvasReviewSection({ orgId }: { orgId?: string }) {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [nodes, setNodes] = useState<CanvasReviewPanelNode[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/creative-canvas${query}`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        const list: CanvasSummary[] = Array.isArray(body?.data?.canvases) ? body.data.canvases : []
        const clientVisible = list.filter((canvas) => canvas.visibility === 'admin_agents_clients' && !canvas.deleted)
        setCanvases(clientVisible)
        setSelectedId((current) => current || clientVisible[0]?.id || '')
      })
      .catch(() => { if (!cancelled) setLoadError('Could not load canvases for review.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query])

  useEffect(() => {
    if (!selectedId) { setNodes(null); return }
    let cancelled = false
    fetch(`/api/v1/creative-canvas/${selectedId}${query}`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        setNodes(Array.isArray(body?.data?.canvas?.nodes) ? body.data.canvas.nodes : [])
      })
      .catch(() => { if (!cancelled) setLoadError('Could not load canvas nodes for review.') })
    return () => { cancelled = true }
  }, [selectedId, query])

  if (loading) return <div className="h-24 rounded-xl bg-surface-container animate-pulse" />
  if (loadError) {
    return (
      <div className="rounded-xl bg-surface-container p-4">
        <p className="text-xs text-red-500">{loadError}</p>
      </div>
    )
  }
  if (!canvases.length) return null

  return (
    <div className="flex flex-col gap-3">
      {canvases.length > 1 && (
        <select
          value={selectedId}
          onChange={(event) => { setNodes(null); setSelectedId(event.target.value) }}
          aria-label="Select canvas to review"
          className="w-full max-w-sm rounded-md bg-surface-container p-2 text-sm text-on-surface outline-none"
        >
          {canvases.map((canvas) => (
            <option key={canvas.id} value={canvas.id}>{canvas.title || canvas.id}</option>
          ))}
        </select>
      )}
      {selectedId && nodes !== null && (
        <CanvasReviewPanel canvasId={selectedId} orgId={orgId} nodes={nodes} />
      )}
      {selectedId && nodes === null && <div className="h-24 rounded-xl bg-surface-container animate-pulse" />}
    </div>
  )
}
