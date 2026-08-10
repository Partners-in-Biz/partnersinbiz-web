'use client'

/**
 * OrgChartCanvas — Paperclip-style agent organisation chart canvas.
 *
 * Hand-rolled tidy-tree layout (no graph library): nodes are laid out
 * top-down by depth, siblings stacked left-to-right, parents centred over
 * their subtree. Connectors are orthogonal elbow paths drawn in an SVG layer;
 * cards are HTML absolutely positioned above it. The whole chart lives inside
 * a transformed container so wheel-zoom (around the cursor), drag-pan and
 * fit-to-view all just adjust one transform.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { AgentOrgNode, OrgTreeNode } from '@/lib/agent-org/types'

export interface OrgChartCanvasHandle {
  fit: () => void
  zoomIn: () => void
  zoomOut: () => void
}

export interface OrgChartCanvasProps {
  nodes: AgentOrgNode[]
  tree: OrgTreeNode[]
  loading: boolean
  error: string | null
  seeding: boolean
  onSeed: () => void
  onSelectNode: (node: AgentOrgNode) => void
}

const CARD_W = 208
const CARD_H = 96
const H_GAP = 56
const V_GAP = 72
const PAD = 48
const MIN_ZOOM = 0.15
const MAX_ZOOM = 2.5

/** Icon chip tint + left accent border per colour key (mirrors AgentCard). */
const COLOR_ICON_BG: Record<string, string> = {
  violet: 'bg-violet-500/15 text-violet-400',
  sky: 'bg-sky-500/15 text-sky-400',
  indigo: 'bg-indigo-500/15 text-indigo-400',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  pink: 'bg-pink-500/15 text-pink-400',
  amber: 'bg-amber-500/15 text-amber-400',
  teal: 'bg-teal-500/15 text-teal-400',
  rose: 'bg-rose-500/15 text-rose-400',
  green: 'bg-green-500/15 text-green-400',
  cyan: 'bg-cyan-500/15 text-cyan-400',
  purple: 'bg-purple-500/15 text-purple-400',
  blue: 'bg-blue-500/15 text-blue-400',
  lime: 'bg-lime-500/15 text-lime-400',
  orange: 'bg-orange-500/15 text-orange-400',
  slate: 'bg-slate-500/15 text-slate-400',
}

const COLOR_BORDER: Record<string, string> = {
  violet: 'border-l-violet-500',
  sky: 'border-l-sky-500',
  indigo: 'border-l-indigo-500',
  emerald: 'border-l-emerald-500',
  pink: 'border-l-pink-500',
  amber: 'border-l-amber-500',
  teal: 'border-l-teal-500',
  rose: 'border-l-rose-500',
  green: 'border-l-green-500',
  cyan: 'border-l-cyan-500',
  purple: 'border-l-purple-500',
  blue: 'border-l-blue-500',
  lime: 'border-l-lime-500',
  orange: 'border-l-orange-500',
  slate: 'border-l-slate-500',
}

interface ViewTransform {
  x: number
  y: number
  k: number
}

interface PositionedNode {
  node: OrgTreeNode
  x: number
  y: number
}

interface ChartLayout {
  positioned: Map<string, PositionedNode>
  contentW: number
  contentH: number
  connections: Array<{ id: string; d: string }>
}

function flattenTree(forest: OrgTreeNode[]): OrgTreeNode[] {
  const out: OrgTreeNode[] = []
  const walk = (n: OrgTreeNode): void => {
    out.push(n)
    n.children.forEach(walk)
  }
  forest.forEach(walk)
  return out
}

/**
 * Tidy-tree layout: leaves get sequential horizontal slots; internal nodes are
 * centred over the midpoint of their first/last child; depth maps to the row.
 */
function computeLayout(forest: OrgTreeNode[]): ChartLayout {
  const all = flattenTree(forest)
  const centerOf = new Map<string, number>()
  const depthOf = new Map<string, number>()
  const parentOf = new Map<string, OrgTreeNode>()

  let slotCursor = 0
  const subtreeLeaves = (node: OrgTreeNode): number => {
    if (node.children.length === 0) {
      centerOf.set(node.id, slotCursor + 0.5)
      slotCursor += 1
      return 1
    }
    let leaves = 0
    for (const child of node.children) {
      parentOf.set(child.id, node)
      leaves += subtreeLeaves(child)
    }
    return leaves
  }

  const centerInternal = (node: OrgTreeNode): void => {
    if (node.children.length === 0) return
    node.children.forEach(centerInternal)
    const first = centerOf.get(node.children[0].id)!
    const last = centerOf.get(node.children[node.children.length - 1].id)!
    centerOf.set(node.id, (first + last) / 2)
  }

  const markDepth = (node: OrgTreeNode, depth: number): void => {
    depthOf.set(node.id, depth)
    node.children.forEach((c) => markDepth(c, depth + 1))
  }

  forest.forEach((root) => {
    subtreeLeaves(root)
    forest.forEach(centerInternal)
    markDepth(root, 0)
  })
  // Internal nodes only have their midpoint once all children are placed —
  // centreInternal above runs per-root AFTER its subtree leaves were assigned.

  const positioned = new Map<string, PositionedNode>()
  for (const node of all) {
    const center = centerOf.get(node.id) ?? 0
    positioned.set(node.id, {
      node,
      x: center * (CARD_W + H_GAP) + PAD - CARD_W / 2,
      y: (depthOf.get(node.id) ?? 0) * (CARD_H + V_GAP) + PAD,
    })
  }

  let maxDepth = 0
  for (const d of depthOf.values()) maxDepth = Math.max(maxDepth, d)

  const contentW = Math.max(slotCursor * (CARD_W + H_GAP) - H_GAP + PAD * 2, CARD_W + PAD * 2)
  const contentH = (maxDepth + 1) * (CARD_H + V_GAP) - V_GAP + PAD * 2

  // Orthogonal elbow connectors: parent bottom-center → horizontal → vertical
  // → horizontal → child top-center.
  const connections: Array<{ id: string; d: string }> = []
  for (const node of all) {
    const parent = node.reportsTo ? parentOf.get(node.id) : undefined
    const childPos = positioned.get(node.id)
    const parentPos = parent ? positioned.get(parent.id) : undefined
    if (!childPos || !parentPos || !parent) continue
    const px = parentPos.x + CARD_W / 2
    const py = parentPos.y + CARD_H
    const cx = childPos.x + CARD_W / 2
    const cy = childPos.y
    const midX = (px + cx) / 2
    const midY = (py + cy) / 2
    connections.push({
      id: `${parent.id}->${node.id}`,
      d: `M ${px} ${py} H ${midX} V ${midY} H ${cx} V ${cy}`,
    })
  }

  return { positioned, contentW, contentH, connections }
}

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))
}

const OrgChartCanvas = forwardRef<OrgChartCanvasHandle, OrgChartCanvasProps>(
  function OrgChartCanvas(
    { nodes, tree, loading, error, seeding, onSeed, onSelectNode },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [view, setView] = useState<ViewTransform>({ x: 40, y: 40, k: 0.75 })
    const userMovedRef = useRef(false)
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
    const [dragging, setDragging] = useState(false)

    const layout = useMemo<ChartLayout | null>(() => {
      if (!tree || tree.length === 0) return null
      return computeLayout(tree)
    }, [tree])

    const fit = useCallback(() => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cw = Math.max(rect.width, 1)
      const ch = Math.max(rect.height, 1)
      if (!layout) {
        setView({ x: 40, y: 40, k: 0.75 })
        return
      }
      const k = clampZoom(Math.min(cw / layout.contentW, ch / layout.contentH) * 0.92)
      const x = (cw - layout.contentW * k) / 2
      const y = (ch - layout.contentH * k) / 2
      userMovedRef.current = false
      setView({ x, y, k })
    }, [layout])

    const zoomBy = useCallback((factor: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.width / 2
      const cy = rect.height / 2
      setView((v) => {
        const k2 = clampZoom(v.k * factor)
        const wx = (cx - v.x) / v.k
        const wy = (cy - v.y) / v.k
        return { k: k2, x: cx - wx * k2, y: cy - wy * k2 }
      })
      userMovedRef.current = true
    }, [])

    useImperativeHandle(ref, () => ({ fit, zoomIn: () => zoomBy(1.2), zoomOut: () => zoomBy(1 / 1.2) }), [fit, zoomBy])

    // Auto-fit once when the chart first loads (skip if the user already interacted).
    const firstLayoutDone = useRef(false)
    useEffect(() => {
      if (!layout || firstLayoutDone.current) return
      firstLayoutDone.current = true
      fit()
    }, [layout, fit])

    // Wheel zoom around cursor — needs a non-passive listener.
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
        setView((v) => {
          const k2 = clampZoom(v.k * factor)
          const wx = (mx - v.x) / v.k
          const wy = (my - v.y) / v.k
          return { k: k2, x: mx - wx * k2, y: my - wy * k2 }
        })
        userMovedRef.current = true
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => el.removeEventListener('wheel', onWheel)
    }, [])

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y }
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (Math.abs(dx) + Math.abs(dy) > 2) userMovedRef.current = true
      setView((v) => ({ ...v, x: drag.origX + dx, y: drag.origY + dy }))
    }

    const endDrag = () => {
      dragRef.current = null
      setDragging(false)
    }

    // ── Frames: loading / error / empty ────────────────────────────────────
    if (loading) {
      return (
        <div className="flex h-full min-h-[480px] items-center justify-center rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]">
          <div className="flex items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
            <span className="pib-skeleton h-4 w-4 rounded-full" />
            Loading org chart…
          </div>
        </div>
      )
    }

    if (!loading && error && nodes.length === 0) {
      return (
        <div className="flex h-full min-h-[480px] items-center justify-center rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-400">
              <span className="material-symbols-outlined text-[20px]">error</span>
            </div>
            <p className="text-sm text-[var(--color-error)]">{error}</p>
            <button type="button" onClick={onSeed} className="btn-pib-ghost btn-pib-sm font-label mt-4">
              Try seeding the default chart
            </button>
          </div>
        </div>
      )
    }

    if (!loading && nodes.length === 0) {
      return (
        <div className="flex h-full min-h-[480px] items-center justify-center rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-400">
              <span className="material-symbols-outlined text-[20px]">account_tree</span>
            </div>
            <p className="text-sm font-medium text-[var(--color-pib-text)]">No agent org chart yet</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Seed the default Paperclip-style chart for this org (Pip at the root, specialists underneath), then edit it to fit your team.
            </p>
            <button
              type="button"
              onClick={onSeed}
              disabled={seeding}
              className="btn-pib-primary btn-pib-sm font-label mt-4 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
              {seeding ? 'Seeding…' : 'Seed default chart'}
            </button>
          </div>
        </div>
      )
    }

    if (!layout) return null

    const chartStyle = {
      transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
      transformOrigin: '0 0',
      width: layout.contentW,
      height: layout.contentH,
    }

    return (
      <div
        ref={containerRef}
        className="relative h-full min-h-[480px] touch-none overflow-hidden rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Zoom / fit indicator */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/80 px-2 py-1 font-mono text-[10px] text-[var(--color-pib-text-muted)] backdrop-blur">
          {Math.round(view.k * 100)}%
        </div>

        {/* Transformed chart layer */}
        <div className="absolute left-0 top-0" style={chartStyle}>
          <svg
            className="absolute left-0 top-0"
            width={layout.contentW}
            height={layout.contentH}
            aria-hidden
          >
            <g stroke="var(--color-pib-line-strong)" strokeWidth={1.5} fill="none" strokeLinejoin="round">
              {layout.connections.map((conn) => (
                <path key={conn.id} d={conn.d} />
              ))}
            </g>
          </svg>

          {Array.from(layout.positioned.values()).map(({ node, x, y }) => {
            const iconClass = COLOR_ICON_BG[node.colorKey] ?? 'bg-white/10 text-[var(--color-pib-text-muted)]'
            const borderClass = COLOR_BORDER[node.colorKey] ?? 'border-l-white/20'
            const modelChip = node.defaultModel ?? 'auto'
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelectNode(node)}
                onPointerDown={(e) => e.stopPropagation()}
                title={`${node.name} — ${node.title}`}
                className={`absolute rounded-lg border border-[var(--color-pib-line)] border-l-2 ${borderClass} bg-[var(--color-pib-surface)] p-2.5 text-left shadow-lg transition-transform duration-100 hover:-translate-y-0.5 hover:border-[var(--color-pib-line-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30`}
                style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
              >
                <div className="flex h-full items-start gap-2">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconClass}`}>
                    <span className="material-symbols-outlined text-[18px]">{node.iconKey}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold leading-tight text-[var(--color-pib-text)]">
                        {node.name}
                      </span>
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${node.status === 'active' ? 'bg-emerald-400' : 'bg-amber-400'}`}
                        title={node.status === 'active' ? 'Active' : 'Paused'}
                      />
                    </div>
                    <div className="truncate text-[11px] leading-tight text-[var(--color-pib-text-muted)]">
                      {node.title}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="max-w-full truncate rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-1.5 py-px font-mono text-[10px] text-[var(--color-pib-text-muted)]">
                        {modelChip}
                      </span>
                      {node.agentId && (
                        <span className="truncate font-mono text-[10px] text-[var(--color-pib-text-faint)]">
                          {node.agentId}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  },
)

export default OrgChartCanvas
