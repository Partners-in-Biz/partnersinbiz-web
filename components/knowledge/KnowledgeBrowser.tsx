'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  KnowledgeItem,
  KnowledgeListing,
  KnowledgeNote,
  KnowledgeScope,
  KnowledgeSection,
} from '@/lib/knowledge/types'

type Props = {
  scope: KnowledgeScope
  agent?: string
  title: string
  eyebrow: string
  description: string
  apiPath?: string
  readOnly?: boolean
  sections?: KnowledgeSection[]
}

type ApiEnvelope<T> = { success: boolean; data?: T; error?: string; upstream?: unknown }
type GraphNote = KnowledgeNote & { section: KnowledgeSection }
type GraphNode = KnowledgeItem & { id: string; section: KnowledgeSection; title: string; x: number; y: number; radius: number; degree: number }
type GraphEdge = { from: string; to: string }
type KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

const SECTIONS: Array<{ value: KnowledgeSection; label: string; icon: string; createLabel: string }> = [
  { value: 'index', label: 'Index', icon: 'article', createLabel: 'Index note title' },
  { value: 'wiki', label: 'Wiki', icon: 'menu_book', createLabel: 'New wiki note' },
  { value: 'raw', label: 'Raw', icon: 'inventory_2', createLabel: 'New raw source' },
  { value: 'logs', label: 'Logs', icon: 'history', createLabel: 'New log title' },
]
const GRAPH_SECTIONS: KnowledgeSection[] = ['index', 'wiki', 'raw', 'logs']

function noteTitle(path: string) {
  return path
    .split('/')
    .pop()
    ?.replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ') || 'Untitled'
}

function slugNoteName(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'new-note'}.md`
}

function formatDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function noteKey(value: string) {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function extractNoteLinks(content: string) {
  const links = new Set<string>()
  const wikiLink = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g
  const markdownLink = /\[[^\]]+\]\(([^)#]+\.md)(?:#[^)]+)?\)/g
  let match: RegExpExecArray | null

  while ((match = wikiLink.exec(content))) links.add(match[1])
  while ((match = markdownLink.exec(content))) links.add(match[1])

  return Array.from(links)
}

function graphId(section: KnowledgeSection, path: string) {
  return `${section}:${path}`
}

function buildKnowledgeGraph(notes: GraphNote[]): KnowledgeGraph {
  const items = notes.map((note) => ({
    path: note.path,
    name: note.name,
    type: 'file' as const,
    sizeBytes: note.sizeBytes,
    updatedAt: note.updatedAt,
    section: note.section,
    id: graphId(note.section, note.path),
  }))
  const byScopedPath = new Map(items.map((item) => [`${item.section}/${item.path}`, item]))
  const byKey = new Map<string, typeof items>()
  for (const item of items) {
    for (const key of [noteKey(item.path), noteKey(noteTitle(item.path))]) {
      const bucket = byKey.get(key) ?? []
      bucket.push(item)
      byKey.set(key, bucket)
    }
  }

  const edges: GraphEdge[] = []
  const seenEdges = new Set<string>()

  for (const source of notes) {
    for (const rawTarget of extractNoteLinks(source.content)) {
      const normalizedTarget = rawTarget.replace(/^\.\//, '')
      const target =
        byScopedPath.get(normalizedTarget) ??
        byKey.get(noteKey(normalizedTarget))?.find((item) => item.section === source.section) ??
        byKey.get(noteKey(normalizedTarget))?.find((item) => item.section === 'wiki') ??
        byKey.get(noteKey(normalizedTarget))?.[0]
      if (!target || target.id === graphId(source.section, source.path)) continue
      const edgeKey = [graphId(source.section, source.path), target.id].sort().join('::')
      if (seenEdges.has(edgeKey)) continue
      seenEdges.add(edgeKey)
      edges.push({ from: graphId(source.section, source.path), to: target.id })
    }
  }

  const degrees = new Map(items.map((item) => [item.id, 0]))
  for (const edge of edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1)
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1)
  }

  const sorted = [...items].sort((a, b) => (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0) || a.id.localeCompare(b.id))
  const centerX = 420
  const centerY = 280
  const nodes = sorted.map((item, index) => {
    const degree = degrees.get(item.id) ?? 0
    if (sorted.length === 1) {
      return { ...item, title: noteTitle(item.path), x: centerX, y: centerY, radius: 12, degree }
    }
    const ring = index < 8 ? 120 : index < 22 ? 195 : 250
    const offset = index < 8 ? index : index < 22 ? index - 8 : index - 22
    const count = index < 8 ? Math.min(sorted.length, 8) : index < 22 ? Math.min(sorted.length - 8, 14) : Math.max(sorted.length - 22, 1)
    const angle = (offset / Math.max(count, 1)) * Math.PI * 2 + (index < 8 ? 0.25 : 0.05)
    return {
      ...item,
      title: noteTitle(item.path),
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
      radius: Math.max(5, Math.min(13, 5 + degree * 2)),
      degree,
    }
  })

  return { nodes, edges }
}

function KnowledgeGraphView({
  graph,
  selectedPath,
  onSelect,
}: {
  graph: KnowledgeGraph
  selectedPath: string | null
  onSelect: (section: KnowledgeSection, path: string) => void
}) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const svgRef = useRef<SVGSVGElement | null>(null)
  const panRef = useRef<{ clientX: number; clientY: number; viewBox: { x: number; y: number; w: number; h: number } } | null>(null)
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 840, h: 560 })
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [tooltip, setTooltip] = useState({ x: 0, y: 0 })

  function zoomAt(clientX: number, clientY: number, direction: 'in' | 'out') {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.w
    const py = viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.h
    const factor = direction === 'in' ? 0.86 : 1.16
    const nextW = Math.max(180, Math.min(1600, viewBox.w * factor))
    const nextH = Math.max(120, Math.min(1100, viewBox.h * factor))
    setViewBox({
      x: px - ((px - viewBox.x) / viewBox.w) * nextW,
      y: py - ((py - viewBox.y) / viewBox.h) * nextH,
      w: nextW,
      h: nextH,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-4">
        <div>
          <h2 className="font-headline text-2xl font-bold text-on-surface">Knowledge Graph</h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            {graph.nodes.length} nodes across index, wiki, raw, and logs · {graph.edges.length} links
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border border-[var(--color-border)] bg-black/30">
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md bg-black/50 px-2 py-1 text-[11px] text-white/70">
          Scroll to zoom · drag empty space
        </div>
        {hoveredNode && (
          <div
            className="pointer-events-none absolute z-20 max-w-xs rounded-md bg-black px-3 py-2 text-xs text-white shadow-xl"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            <div className="font-medium">{hoveredNode.title}</div>
            <div className="mt-1 text-white/60">{hoveredNode.section} · {hoveredNode.path}</div>
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="h-[62vh] min-h-[460px] w-full cursor-grab active:cursor-grabbing"
          onWheel={(event) => {
            event.preventDefault()
            zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 'in' : 'out')
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return
            panRef.current = { clientX: event.clientX, clientY: event.clientY, viewBox }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const pan = panRef.current
            if (!pan || !svgRef.current) return
            const rect = svgRef.current.getBoundingClientRect()
            const dx = ((event.clientX - pan.clientX) / rect.width) * pan.viewBox.w
            const dy = ((event.clientY - pan.clientY) / rect.height) * pan.viewBox.h
            setViewBox({ ...pan.viewBox, x: pan.viewBox.x - dx, y: pan.viewBox.y - dy })
          }}
          onPointerUp={(event) => {
            panRef.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerLeave={() => {
            panRef.current = null
            setHoveredNode(null)
          }}
        >
          <defs>
            <radialGradient id="knowledge-node-glow">
              <stop offset="0%" stopColor="#F5A623" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#F5A623" stopOpacity="0" />
            </radialGradient>
          </defs>
          {graph.edges.map((edge) => {
            const from = nodeById.get(edge.from)
            const to = nodeById.get(edge.to)
            if (!from || !to) return null
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
              />
            )
          })}
          {graph.nodes.map((node) => {
            const active = selectedPath === node.path
            return (
              <g key={node.path}>
                {node.degree > 1 && (
                  <circle cx={node.x} cy={node.y} r={node.radius + 12} fill="url(#knowledge-node-glow)" opacity={active ? 0.9 : 0.4} />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill={active ? 'var(--color-pib-accent)' : node.degree > 0 ? '#ffffff' : '#9ca3af'}
                  stroke={active ? '#000' : 'rgba(255,255,255,0.5)'}
                  strokeWidth={active ? 3 : 1}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${node.title} from ${node.section}`}
                  onMouseEnter={(event) => {
                    setHoveredNode(node)
                    const rect = svgRef.current?.getBoundingClientRect()
                    setTooltip({ x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) })
                  }}
                  onMouseMove={(event) => {
                    const rect = svgRef.current?.getBoundingClientRect()
                    setTooltip({ x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) })
                  }}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => onSelect(node.section, node.path)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelect(node.section, node.path)
                  }}
                />
                <title>{node.title} · {node.section}/{node.path}</title>
                {(active || node.degree >= 2) && (
                  <text
                    x={node.x + node.radius + 8}
                    y={node.y + 4}
                    fill="rgba(255,255,255,0.82)"
                    fontSize="12"
                    className="pointer-events-none"
                  >
                    {node.title.length > 24 ? `${node.title.slice(0, 24)}...` : node.title}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split('\n')
  let inCode = false
  const code: string[] = []
  const nodes: React.ReactNode[] = []

  function flushCode(index: number) {
    if (code.length === 0) return
    nodes.push(
      <pre key={`code-${index}`} className="overflow-auto rounded-md bg-black/70 p-4 text-sm text-white">
        <code>{code.join('\n')}</code>
      </pre>,
    )
    code.length = 0
  }

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (inCode) flushCode(index)
      inCode = !inCode
      return
    }
    if (inCode) {
      code.push(line)
      return
    }
    if (line.startsWith('# ')) {
      nodes.push(<h1 key={index} className="font-headline text-3xl font-bold text-on-surface">{line.slice(2)}</h1>)
    } else if (line.startsWith('## ')) {
      nodes.push(<h2 key={index} className="pt-4 font-headline text-2xl font-bold text-on-surface">{line.slice(3)}</h2>)
    } else if (line.startsWith('### ')) {
      nodes.push(<h3 key={index} className="pt-3 text-lg font-semibold text-on-surface">{line.slice(4)}</h3>)
    } else if (/^\s*[-*]\s+/.test(line)) {
      nodes.push(<p key={index} className="pl-4 text-sm leading-7 text-on-surface-variant">• {line.replace(/^\s*[-*]\s+/, '')}</p>)
    } else if (line.trim() === '---') {
      nodes.push(<hr key={index} className="border-[var(--color-border)]" />)
    } else if (line.trim()) {
      nodes.push(<p key={index} className="text-sm leading-7 text-on-surface-variant">{line}</p>)
    } else {
      nodes.push(<div key={index} className="h-2" />)
    }
  })
  flushCode(lines.length + 1)

  return <div className="space-y-3">{nodes}</div>
}

export function KnowledgeBrowser({
  scope,
  agent,
  title,
  eyebrow,
  description,
  apiPath = '/api/v1/admin/knowledge',
  readOnly = false,
  sections,
}: Props) {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [note, setNote] = useState<KnowledgeNote | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [section, setSection] = useState<KnowledgeSection>('wiki')
  const [graphOpen, setGraphOpen] = useState(false)
  const [graphNotes, setGraphNotes] = useState<GraphNote[]>([])
  const [graphLoading, setGraphLoading] = useState(false)
  const listRequestRef = useRef(0)
  const noteRequestRef = useRef(0)
  const visibleSections = useMemo(
    () => SECTIONS.filter((tab) => !sections || sections.includes(tab.value)),
    [sections],
  )
  const graphSections = useMemo(() => sections && sections.length > 0 ? sections : GRAPH_SECTIONS, [sections])

  const queryBase = useMemo(() => {
    const params = new URLSearchParams({ scope })
    params.set('section', section)
    if (agent) params.set('agent', agent)
    return params
  }, [agent, scope, section])

  async function loadList() {
    const requestId = ++listRequestRef.current
    setLoading(true)
    setError(null)
    const res = await fetch(`${apiPath}?${queryBase.toString()}`)
    const body = await res.json() as ApiEnvelope<KnowledgeListing>
    if (requestId !== listRequestRef.current) return
    if (!res.ok || !body.success || !body.data) {
      setError(body.error || 'Could not load knowledge base')
      setLoading(false)
      return
    }
    const files = body.data.items.filter((item) => item.type === 'file')
    setItems(files)
    const nextPath = selectedPath && files.some((item) => item.path === selectedPath)
      ? selectedPath
      : files[0]?.path ?? null
    setSelectedPath(nextPath)
    setLoading(false)
  }

  async function loadNote(path: string) {
    const requestId = ++noteRequestRef.current
    setError(null)
    const params = new URLSearchParams(queryBase)
    params.set('path', path)
    const res = await fetch(`${apiPath}?${params.toString()}`)
    const body = await res.json() as ApiEnvelope<KnowledgeNote>
    if (requestId !== noteRequestRef.current) return
    if (!res.ok || !body.success || !body.data) {
      setError(body.error || 'Could not load note')
      return
    }
    setNote(body.data)
    setDraft(body.data.content)
  }

  async function loadGraphNotes() {
    if (graphNotes.length > 0) return
    setGraphLoading(true)
    setError(null)
    try {
      const notes: GraphNote[] = []
      for (const graphSection of graphSections) {
        const listParams = new URLSearchParams({ scope, section: graphSection })
        if (agent) listParams.set('agent', agent)
        const listRes = await fetch(`${apiPath}?${listParams.toString()}`)
        const listBody = await listRes.json() as ApiEnvelope<KnowledgeListing>
        if (!listRes.ok || !listBody.success || !listBody.data) throw new Error(listBody.error || `Could not load ${graphSection}`)
        const files = listBody.data.items.filter((item) => item.type === 'file')
        const sectionNotes = await Promise.all(
          files.map(async (item) => {
            const params = new URLSearchParams(listParams)
            params.set('path', item.path)
            const res = await fetch(`${apiPath}?${params.toString()}`)
            const body = await res.json() as ApiEnvelope<KnowledgeNote>
            if (!res.ok || !body.success || !body.data) throw new Error(body.error || `Could not load ${graphSection}/${item.path}`)
            return { ...body.data, section: graphSection }
          }),
        )
        notes.push(...sectionNotes)
      }
      setGraphNotes(notes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load knowledge graph')
    } finally {
      setGraphLoading(false)
    }
  }

  async function saveNote(path: string, content: string) {
    setSaving(true)
    setError(null)
    if (readOnly) return false
    const res = await fetch(apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, section, agent, path, content }),
    })
    const body = await res.json() as ApiEnvelope<unknown>
    setSaving(false)
    if (!res.ok || !body.success) {
      setError(body.error || 'Could not save note')
      return false
    }
    await loadList()
    await loadNote(path)
    setMode('preview')
    setGraphNotes([])
    return true
  }

  function createDraft() {
    const name = slugNoteName(newTitle)
    const path = section === 'index' ? 'index.md' : name
    const heading = newTitle.trim() || 'New Note'
    setSelectedPath(path)
    setNote({ path, name, content: `# ${heading}\n\n` })
    setDraft(`# ${heading}\n\n`)
    setNewTitle('')
    setMode('edit')
    setGraphOpen(false)
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryBase])

  useEffect(() => {
    if (selectedPath) loadNote(selectedPath)
    else {
      setNote(null)
      setDraft('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath])

  useEffect(() => {
    setGraphNotes([])
  }, [items, section])

  const graph = useMemo(() => buildKnowledgeGraph(graphNotes), [graphNotes])

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="eyebrow">{eyebrow}</p>
          <button type="button" onClick={loadList} className="pib-btn-secondary">
            <span className="material-symbols-outlined text-base">sync</span>
            Refresh
          </button>
        </div>
        <h1 className="pib-page-title mt-2">{title}</h1>
        <p className="pib-page-sub mt-2 max-w-3xl">{description}</p>
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="bento-card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2" aria-label="Knowledge sections">
              {visibleSections.map((tab) => {
                const active = section === tab.value
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => {
                      noteRequestRef.current += 1
                      setSection(tab.value)
                      setSelectedPath(null)
                      setNote(null)
                      setDraft('')
                      setMode('preview')
                      setGraphOpen(false)
                    }}
                    title={tab.label}
                    aria-label={tab.label}
                    className={`group relative grid size-10 place-items-center rounded-md transition-colors ${
                      active
                        ? 'bg-[var(--color-pib-accent)] text-black'
                        : 'bg-[var(--color-surface)] text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">{tab.icon}</span>
                    <span className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      {tab.label}
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  const next = !graphOpen
                  setGraphOpen(next)
                  setMode('preview')
                  if (next) void loadGraphNotes()
                }}
                title="Graph"
                aria-label="Graph"
                className={`group relative grid size-10 place-items-center rounded-md transition-colors ${
                  graphOpen
                    ? 'bg-[var(--color-pib-accent)] text-black'
                    : 'bg-[var(--color-surface)] text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-base">hub</span>
                <span className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Graph
                </span>
              </button>
            </div>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-1 text-xs text-on-surface-variant">
              {items.length}
            </span>
          </div>

          {!readOnly && section !== 'index' && (
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={SECTIONS.find((tab) => tab.value === section)?.createLabel ?? 'New note title'}
                className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-on-surface outline-none focus:border-[var(--color-pib-accent)]"
              />
              <button
                type="button"
                onClick={createDraft}
                className="grid size-10 place-items-center rounded-md bg-[var(--color-pib-accent)] text-black"
                aria-label="Create note"
              >
                <span className="material-symbols-outlined text-base">add</span>
              </button>
            </div>
          )}

          <div className="max-h-[65vh] space-y-1 overflow-auto pr-1">
            {loading ? (
              Array.from({ length: 8 }).map((_, index) => <div key={index} className="pib-skeleton h-11" />)
            ) : items.length === 0 ? (
              <p className="rounded-md bg-[var(--color-surface)] p-3 text-sm text-on-surface-variant">No notes found.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                  setSelectedPath(item.path)
                    setMode('preview')
                    setGraphOpen(false)
                  }}
                  className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                    selectedPath === item.path
                      ? 'bg-[var(--color-pib-accent)] text-black'
                      : 'text-on-surface-variant hover:bg-[var(--color-surface)] hover:text-on-surface'
                  }`}
                >
                  <span className="block truncate text-sm font-medium">{noteTitle(item.path)}</span>
                  <span className="block truncate text-xs opacity-75">{item.path}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="bento-card min-h-[70vh] space-y-5">
          {graphOpen ? (
            graphLoading ? (
              <div className="space-y-4">
                <div className="pib-skeleton h-16" />
                <div className="pib-skeleton h-[58vh]" />
              </div>
            ) : graph.nodes.length > 0 ? (
              <KnowledgeGraphView
                graph={graph}
                selectedPath={selectedPath}
                onSelect={(graphSection, path) => {
                  setSection(graphSection)
                  setSelectedPath(path)
                  setMode('preview')
                  setGraphOpen(false)
                }}
              />
            ) : (
              <div className="grid min-h-[50vh] place-items-center text-center">
                <div>
                  <span className="material-symbols-outlined text-5xl text-[var(--color-pib-accent)]">hub</span>
                  <h2 className="mt-3 font-headline text-2xl font-bold text-on-surface">No graph yet</h2>
                  <p className="mt-2 text-sm text-on-surface-variant">Add notes or links like [[Another Note]] to build connections.</p>
                </div>
              </div>
            )
          ) : note ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4">
                <div className="min-w-0">
                  <h2 className="truncate font-headline text-2xl font-bold text-on-surface">{noteTitle(note.path)}</h2>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {note.path}{note.updatedAt ? ` · Updated ${formatDate(note.updatedAt)}` : ''}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}
                      className="pib-btn-secondary"
                    >
                      <span className="material-symbols-outlined text-base">{mode === 'preview' ? 'edit' : 'visibility'}</span>
                      {mode === 'preview' ? 'Edit' : 'Preview'}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveNote(note.path, draft)}
                      disabled={saving}
                      className="btn-pib-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-base">save</span>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>

              {mode === 'edit' && !readOnly ? (
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck
                  className="min-h-[58vh] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-sm leading-7 text-on-surface outline-none focus:border-[var(--color-pib-accent)]"
                />
              ) : (
                <MarkdownPreview content={draft} />
              )}
            </>
          ) : (
            <div className="grid min-h-[50vh] place-items-center text-center">
              <div>
                <span className="material-symbols-outlined text-5xl text-[var(--color-pib-accent)]">menu_book</span>
                <h2 className="mt-3 font-headline text-2xl font-bold text-on-surface">No note selected</h2>
                <p className="mt-2 text-sm text-on-surface-variant">Create or select a Markdown note to start editing.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
