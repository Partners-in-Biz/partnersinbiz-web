'use client'

import { useEffect, useRef, useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

interface CanvasTopBarProps {
  eyebrow: string
  title: string
  canRename: boolean
  onRename: (next: string) => void
  saveLabel: string
  saving: boolean
  saveDisabled: boolean
  onSave: () => void
  autoSaveEnabled: boolean
  onToggleAutoSave: (next: boolean) => void
  presenceCount: number
  onOpenChat: () => void
  onShare: () => void
  onHome?: () => void
  immersive?: boolean
  onToggleImmersive?: () => void
  creditsLabel?: string
}

function barButton(active = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: '0 12px',
    borderRadius: 9,
    border: `1px solid ${active ? canvasTheme.accent : canvasTheme.border}`,
    background: active ? `${canvasTheme.accent}1f` : canvasTheme.surface,
    color: active ? canvasTheme.accent : canvasTheme.text,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }
}

/** Higgsfield-style top bar: inline rename, Team Chat, Share, save state. */
export default function CanvasTopBar({
  eyebrow,
  title,
  canRename,
  onRename,
  saveLabel,
  saving,
  saveDisabled,
  onSave,
  autoSaveEnabled,
  onToggleAutoSave,
  presenceCount,
  onOpenChat,
  onShare,
  onHome,
  immersive,
  onToggleImmersive,
  creditsLabel,
}: CanvasTopBarProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(title)
  }, [title])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== title) onRename(next)
    else setDraft(title)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 12,
        background: canvasTheme.surface,
        border: `1px solid ${canvasTheme.border}`,
      }}
    >
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        {onHome ? (
          <button
            type="button"
            aria-label="All canvases"
            title="All canvases"
            onClick={onHome}
            style={{ width: 32, height: 32, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 8, border: `1px solid ${canvasTheme.border}`, background: canvasTheme.surfaceRaised, color: canvasTheme.text, cursor: 'pointer', fontSize: 14 }}
          >
            ⬓
          </button>
        ) : null}
        <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: canvasTheme.textMuted }}>
          {eyebrow}
        </p>
        {editing && canRename ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                setDraft(title)
                setEditing(false)
              }
            }}
            aria-label="Canvas title"
            style={{
              marginTop: 2,
              width: 'min(60vw, 420px)',
              background: canvasTheme.bg,
              border: `1px solid ${canvasTheme.borderActive}`,
              borderRadius: 8,
              color: canvasTheme.text,
              fontSize: 18,
              fontWeight: 700,
              padding: '4px 8px',
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => canRename && setEditing(true)}
            title={canRename ? 'Rename canvas' : undefined}
            style={{
              marginTop: 2,
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: canvasTheme.text,
              fontSize: 18,
              fontWeight: 700,
              cursor: canRename ? 'text' : 'default',
              maxWidth: 'min(60vw, 480px)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
            }}
          >
            {title}
          </button>
        )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: canvasTheme.textMuted, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={autoSaveEnabled}
            onChange={(event) => onToggleAutoSave(event.target.checked)}
          />
          Auto-save versions
        </label>
        {creditsLabel ? (
          <span
            title="Creative Canvas credits used"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 34, padding: '0 10px', borderRadius: 9, border: `1px solid ${canvasTheme.border}`, background: canvasTheme.surface, color: canvasTheme.accent, fontSize: 13, fontWeight: 700 }}
          >
            ✦ {creditsLabel}
          </span>
        ) : null}
        {onToggleImmersive ? (
          <button type="button" onClick={onToggleImmersive} style={barButton(immersive)} title={immersive ? 'Show dashboard' : 'Immersive canvas'}>
            {immersive ? '⛶ Canvas' : '▦ Dashboard'}
          </button>
        ) : null}
        <button type="button" onClick={onOpenChat} style={barButton()}>
          💬 Team Chat{presenceCount > 0 ? ` · ${presenceCount}` : ''}
        </button>
        <button type="button" onClick={onShare} style={barButton()}>
          ⤴ Share
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          style={{
            ...barButton(true),
            background: canvasTheme.accent,
            color: canvasTheme.accentText,
            border: `1px solid ${canvasTheme.accent}`,
            opacity: saveDisabled ? 0.5 : 1,
            cursor: saveDisabled ? 'default' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  )
}
