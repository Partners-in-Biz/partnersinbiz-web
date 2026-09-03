'use client'

import { useEffect, useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import { starterCanvasTemplates } from '@/lib/creative-canvas/starter-templates'
import CreativeProviderConnections from '@/components/creative-canvas/connections/CreativeProviderConnections'
import type { CreativeCanvasEdge, CreativeCanvasNode } from '@/lib/creative-canvas/types'

export interface CanvasBoardSummary {
  id: string
  title: string
  purpose?: string
  updatedLabel?: string
  thumbnailUrl?: string
  nodes?: CreativeCanvasNode[]
  edges?: CreativeCanvasEdge[]
}

export interface CanvasTemplateSummary {
  id: string
  title: string
  description?: string
  thumbnailUrl?: string
  nodes?: CreativeCanvasNode[]
  edges?: CreativeCanvasEdge[]
}

export interface CanvasLandingProps {
  boards: CanvasBoardSummary[]
  templates: CanvasTemplateSummary[]
  onCreate: () => void
  onOpenBoard: (id: string) => void
  onUseTemplate: (id: string) => void
  onRenameBoard?: (id: string, title: string) => void
  onDeleteBoard?: (id: string) => void
  orgId?: string
  /** Tab to focus when the landing is (re)opened  -  e.g. 'providers' from a Connect chip. */
  initialTab?: 'all' | 'templates' | 'providers'
}

type LandingTab = 'all' | 'templates' | 'providers'

const thumbStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 10',
  objectFit: 'cover',
  borderRadius: '10px',
  display: 'block',
}

const placeholderStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 10',
  borderRadius: '10px',
  background: `linear-gradient(135deg, ${canvasTheme.surfaceRaised}, ${canvasTheme.surface})`,
}

const nodeTypeLabels: Record<CreativeCanvasNode['type'], string> = {
  source: 'Source',
  brief: 'Brief',
  prompt: 'Prompt',
  model: 'Model',
  edit: 'Edit',
  review: 'Review',
  output: 'Output',
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value)
}

function deriveBoardThumbnail(board: CanvasBoardSummary): string | undefined {
  if (isHttpUrl(board.thumbnailUrl)) return board.thumbnailUrl
  return board.nodes
    ?.map((node) => node.output?.thumbnailUrl ?? node.output?.url ?? node.source?.thumbnailUrl ?? node.source?.previewUrl ?? node.source?.url)
    .find(isHttpUrl)
}

function deriveTemplateThumbnail(template: CanvasTemplateSummary): string | undefined {
  if (isHttpUrl(template.thumbnailUrl)) return template.thumbnailUrl
  return template.nodes
    ?.map((node) => node.output?.thumbnailUrl ?? node.output?.url ?? node.source?.thumbnailUrl ?? node.source?.previewUrl ?? node.source?.url)
    .find(isHttpUrl)
}

function buildTypeSummary(nodes: CreativeCanvasNode[] = []): string[] {
  const ordered = nodes.reduce<CreativeCanvasNode['type'][]>((types, node) => {
    if (!types.includes(node.type)) types.push(node.type)
    return types
  }, [])
  return ordered.slice(0, 3).map((type) => nodeTypeLabels[type] ?? type)
}

function BoardGraphPreview({ board }: { board: CanvasBoardSummary }) {
  const nodes = (board.nodes ?? []).slice(0, 7)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = (board.edges ?? []).filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)).slice(0, 8)

  if (!nodes.length) return <div style={placeholderStyle} aria-label="Empty canvas preview" />

  const minX = Math.min(...nodes.map((node) => node.position.x))
  const maxX = Math.max(...nodes.map((node) => node.position.x))
  const minY = Math.min(...nodes.map((node) => node.position.y))
  const maxY = Math.max(...nodes.map((node) => node.position.y))
  const spreadX = Math.max(maxX - minX, 1)
  const spreadY = Math.max(maxY - minY, 1)
  const points = new Map(nodes.map((node, index) => {
    const x = 16 + ((node.position.x - minX) / spreadX) * 68
    const y = 18 + ((node.position.y - minY) / spreadY) * 58
    return [node.id, {
      x: spreadX === 1 ? 20 + (index % 4) * 20 : x,
      y: spreadY === 1 ? 24 + Math.floor(index / 4) * 30 : y,
      node,
    }]
  }))

  return (
    <div
      aria-label={`${nodes.length} node canvas preview`}
      style={{
        ...placeholderStyle,
        position: 'relative',
        overflow: 'hidden',
        border: `1px solid ${canvasTheme.border}`,
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 100 72" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {edges.map((edge) => {
          const source = points.get(edge.sourceNodeId)
          const target = points.get(edge.targetNodeId)
          if (!source || !target) return null
          return (
            <line
              key={edge.id}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="rgba(226,232,240,0.28)"
              strokeWidth="1.2"
            />
          )
        })}
      </svg>
      {[...points.entries()].map(([id, point]) => {
        const hasMedia = Boolean(point.node.output?.url || point.node.output?.thumbnailUrl || point.node.source?.url || point.node.source?.thumbnailUrl)
        return (
          <span
            key={id}
            title={`${nodeTypeLabels[point.node.type] ?? point.node.type}: ${point.node.title}`}
            style={{
              position: 'absolute',
              left: `${point.x}%`,
              top: `${point.y}%`,
              width: hasMedia ? 16 : 12,
              height: hasMedia ? 16 : 12,
              transform: 'translate(-50%, -50%)',
              borderRadius: hasMedia ? 5 : 999,
              background: hasMedia ? canvasTheme.accent : canvasTheme.surfaceRaised,
              border: `1px solid ${hasMedia ? canvasTheme.accent : canvasTheme.border}`,
              boxShadow: '0 8px 20px rgba(0,0,0,0.28)',
            }}
          />
        )
      })}
    </div>
  )
}

function TemplateGraphPreview({ template }: { template: CanvasTemplateSummary }) {
  return (
    <BoardGraphPreview
      board={{
        id: template.id,
        title: template.title,
        nodes: template.nodes,
        edges: template.edges,
      }}
    />
  )
}

export default function CanvasLanding({
  boards,
  templates,
  onCreate,
  onOpenBoard,
  onUseTemplate,
  onRenameBoard,
  onDeleteBoard,
  orgId,
  initialTab,
}: CanvasLandingProps) {
  const [tab, setTab] = useState<LandingTab>(initialTab ?? 'all')
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const commitRename = (id: string) => {
    const next = renameDraft.trim()
    setRenamingId(null)
    if (next && onRenameBoard) onRenameBoard(id, next)
  }

  const boardActionStyle: React.CSSProperties = {
    width: 26,
    height: 26,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 7,
    border: `1px solid ${canvasTheme.border}`,
    background: canvasTheme.surfaceRaised,
    color: canvasTheme.text,
    cursor: 'pointer',
    fontSize: 12,
  }

  const tabButton = (id: LandingTab, label: string) => {
    const active = tab === id
    return (
      <button
        key={id}
        type="button"
        onClick={() => setTab(id)}
        aria-pressed={active}
        style={{
          appearance: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px 16px',
          borderRadius: '999px',
          fontSize: '14px',
          fontWeight: 600,
          background: active ? canvasTheme.accent : 'transparent',
          color: active ? canvasTheme.accentText : canvasTheme.textMuted,
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <div
      style={{
        minHeight: '100%',
        background: canvasTheme.bg,
        color: canvasTheme.text,
        padding: '32px',
      }}
    >
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700 }}>Creative Canvas</h1>
      </header>

      <div
        role="tablist"
        style={{
          display: 'inline-flex',
          gap: '4px',
          marginBottom: '28px',
          padding: '4px',
          borderRadius: '999px',
          background: canvasTheme.surface,
          border: `1px solid ${canvasTheme.border}`,
        }}
      >
        {tabButton('all', 'All Canvases')}
        {tabButton('templates', 'Templates')}
        {tabButton('providers', 'Providers')}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '20px',
        }}
      >
        {tab === 'all' && (
          <>
            <button
              type="button"
              onClick={onCreate}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                minHeight: '180px',
                borderRadius: canvasTheme.radius,
                border: `2px dashed ${canvasTheme.border}`,
                background: 'transparent',
                color: canvasTheme.textMuted,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  border: `1px solid ${canvasTheme.border}`,
                  fontSize: '24px',
                  lineHeight: 1,
                }}
              >
                +
              </span>
              <span style={{ fontSize: '15px', fontWeight: 600 }}>Create Canvas</span>
            </button>

            {boards.map((board) => (
              <div key={board.id} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => onOpenBoard(board.id)}
                  aria-label={`Open ${board.title}`}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    padding: '12px',
                    width: '100%',
                    borderRadius: canvasTheme.radius,
                    border: `1px solid ${canvasTheme.border}`,
                    background: canvasTheme.surface,
                    color: canvasTheme.text,
                    boxShadow: canvasTheme.nodeShadow,
                  }}
                >
                  {deriveBoardThumbnail(board) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={deriveBoardThumbnail(board)} alt="" style={thumbStyle} />
                  ) : (
                    <BoardGraphPreview board={board} />
                  )}
                  <div>
                    {renamingId === board.id ? (
                      <input
                        aria-label={`Rename ${board.title}`}
                        value={renameDraft}
                        autoFocus
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename(board.id)
                          if (event.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={() => commitRename(board.id)}
                        style={{ width: '100%', fontSize: '15px', fontWeight: 600, background: canvasTheme.surfaceRaised, color: canvasTheme.text, border: `1px solid ${canvasTheme.border}`, borderRadius: 6, padding: '2px 6px' }}
                      />
                    ) : (
                      <div style={{ fontSize: '15px', fontWeight: 600 }}>{board.title}</div>
                    )}
                    {board.updatedLabel && (
                      <div style={{ fontSize: '13px', color: canvasTheme.textMuted, marginTop: '2px' }}>
                        {board.updatedLabel}
                      </div>
                    )}
                    {board.purpose && (
                      <div style={{ fontSize: '13px', color: canvasTheme.textMuted, marginTop: '4px', lineHeight: 1.35 }}>
                        {board.purpose}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: canvasTheme.textMuted }}>
                        {(board.nodes?.length ?? 0) > 0
                          ? `${board.nodes?.length ?? 0} nodes · ${board.edges?.length ?? 0} links`
                          : 'Empty canvas'}
                      </span>
                      {buildTypeSummary(board.nodes).map((label) => (
                        <span
                          key={label}
                          style={{
                            fontSize: '11px',
                            color: canvasTheme.text,
                            border: `1px solid ${canvasTheme.border}`,
                            background: canvasTheme.surfaceRaised,
                            borderRadius: 999,
                            padding: '2px 6px',
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
                {(onRenameBoard || onDeleteBoard) && (
                  <div style={{ position: 'absolute', top: 18, right: 18, display: 'flex', gap: 4 }}>
                    {onRenameBoard ? (
                      <button
                        type="button"
                        aria-label={`Rename canvas ${board.title}`}
                        title="Rename"
                        style={boardActionStyle}
                        onClick={(event) => {
                          event.stopPropagation()
                          setRenamingId(board.id)
                          setRenameDraft(board.title)
                        }}
                      >
                        ✎
                      </button>
                    ) : null}
                    {onDeleteBoard ? (
                      <button
                        type="button"
                        aria-label={`Delete canvas ${board.title}`}
                        title="Delete"
                        style={{ ...boardActionStyle, color: '#ff7a7a' }}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (window.confirm(`Delete "${board.title}"? This canvas will be removed for everyone.`)) {
                            onDeleteBoard(board.id)
                          }
                        }}
                      >
                        🗑
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'templates' && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <section>
              <p
                style={{
                  margin: '0 0 12px',
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                  color: canvasTheme.textMuted,
                }}
              >
                Starter templates
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '20px',
                }}
              >
                {starterCanvasTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    id={template.id ?? ''}
                    title={template.title}
                    description={template.description}
                    nodes={template.nodes}
                    edges={template.edges}
                    isStarter
                    onUseTemplate={onUseTemplate}
                  />
                ))}
              </div>
            </section>

            {templates.length > 0 && (
              <section>
                <p
                  style={{
                    margin: '0 0 12px',
                    fontSize: '13px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    color: canvasTheme.textMuted,
                  }}
                >
                  Your templates
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: '20px',
                  }}
                >
                  {templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      id={template.id}
                      title={template.title}
                      description={template.description}
                      thumbnailUrl={template.thumbnailUrl}
                      nodes={template.nodes}
                      edges={template.edges}
                      onUseTemplate={onUseTemplate}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'providers' && (
          <div style={{ gridColumn: '1 / -1', maxWidth: 640 }}>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: '13px',
                fontWeight: 600,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                color: canvasTheme.textMuted,
              }}
            >
              Creative providers
            </p>
            {orgId ? (
              <CreativeProviderConnections orgId={orgId} />
            ) : (
              <div style={{ fontSize: 13, color: canvasTheme.textMuted }}>
                Select an organisation to manage provider connections.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface TemplateCardProps {
  id: string
  title: string
  description?: string
  thumbnailUrl?: string
  nodes?: CreativeCanvasNode[]
  edges?: CreativeCanvasEdge[]
  isStarter?: boolean
  onUseTemplate: (id: string) => void
}

function TemplateCard({ id, title, description, thumbnailUrl, nodes, edges, isStarter, onUseTemplate }: TemplateCardProps) {
  const template = { id, title, description, thumbnailUrl, nodes, edges }
  const derivedThumbnail = deriveTemplateThumbnail(template)

  return (
    <button
      type="button"
      onClick={() => onUseTemplate(id)}
      style={{
        appearance: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '12px',
        position: 'relative',
        borderRadius: canvasTheme.radius,
        border: `1px solid ${canvasTheme.border}`,
        background: canvasTheme.surface,
        color: canvasTheme.text,
        boxShadow: canvasTheme.nodeShadow,
      }}
    >
      {isStarter && (
        <span
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            padding: '3px 8px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            background: canvasTheme.accent,
            color: canvasTheme.accentText,
            zIndex: 1,
          }}
        >
          Starter
        </span>
      )}
      {derivedThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={derivedThumbnail} alt="" style={thumbStyle} />
      ) : (
        <TemplateGraphPreview template={template} />
      )}
      <div>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>{title}</div>
        {description && (
          <div style={{ fontSize: '13px', color: canvasTheme.textMuted, marginTop: '2px' }}>
            {description}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: canvasTheme.textMuted }}>
            {(nodes?.length ?? 0) > 0
              ? `${nodes?.length ?? 0} nodes · ${edges?.length ?? 0} links`
              : 'Empty template'}
          </span>
          {buildTypeSummary(nodes).map((label) => (
            <span
              key={label}
              style={{
                fontSize: '11px',
                color: canvasTheme.text,
                border: `1px solid ${canvasTheme.border}`,
                background: canvasTheme.surfaceRaised,
                borderRadius: 999,
                padding: '2px 6px',
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}
