'use client'

import { useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import { starterCanvasTemplates } from '@/lib/creative-canvas/starter-templates'
import CreativeProviderConnections from '@/components/creative-canvas/connections/CreativeProviderConnections'

export interface CanvasBoardSummary {
  id: string
  title: string
  updatedLabel?: string
  thumbnailUrl?: string
}

export interface CanvasTemplateSummary {
  id: string
  title: string
  description?: string
  thumbnailUrl?: string
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

export default function CanvasLanding({
  boards,
  templates,
  onCreate,
  onOpenBoard,
  onUseTemplate,
  onRenameBoard,
  onDeleteBoard,
  orgId,
}: CanvasLandingProps) {
  const [tab, setTab] = useState<LandingTab>('all')
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
                  {board.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={board.thumbnailUrl} alt="" style={thumbStyle} />
                  ) : (
                    <div style={placeholderStyle} aria-hidden="true" />
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
  isStarter?: boolean
  onUseTemplate: (id: string) => void
}

function TemplateCard({ id, title, description, thumbnailUrl, isStarter, onUseTemplate }: TemplateCardProps) {
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
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt="" style={thumbStyle} />
      ) : (
        <div style={placeholderStyle} aria-hidden="true" />
      )}
      <div>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>{title}</div>
        {description && (
          <div style={{ fontSize: '13px', color: canvasTheme.textMuted, marginTop: '2px' }}>
            {description}
          </div>
        )}
      </div>
    </button>
  )
}
