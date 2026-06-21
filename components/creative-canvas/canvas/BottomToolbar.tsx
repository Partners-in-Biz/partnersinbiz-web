'use client'

import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

export type CanvasTool =
  | 'select'
  | 'pan'
  | 'sticky_note'
  | 'text'
  | 'connector'
  | 'reaction'
  | 'comment'
  | 'frame'
  | 'add'

interface BottomToolbarProps {
  activeTool: CanvasTool
  onTool: (tool: CanvasTool) => void
}

interface ToolDef {
  tool: CanvasTool
  label: string
  glyph: string
  /** Tools not yet wired render disabled-with-tooltip to match Higgsfield's affordance set. */
  enabled: boolean
}

const TOOLS: ToolDef[] = [
  { tool: 'select', label: 'Select', glyph: '⤤', enabled: true },
  { tool: 'pan', label: 'Pan', glyph: '✋', enabled: true },
  { tool: 'sticky_note', label: 'Sticky note', glyph: '🗒', enabled: true },
  { tool: 'text', label: 'Text', glyph: 'T', enabled: true },
  { tool: 'connector', label: 'Connector', glyph: '↗', enabled: false },
  { tool: 'reaction', label: 'Reaction', glyph: '👍', enabled: false },
  { tool: 'comment', label: 'Comment', glyph: '💬', enabled: false },
  { tool: 'frame', label: 'Frame', glyph: '⊡', enabled: false },
  { tool: 'add', label: 'Add node', glyph: '＋', enabled: true },
]

/** Floating centered tool dock, Higgsfield-style. */
export default function BottomToolbar({ activeTool, onTool }: BottomToolbarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 6,
        borderRadius: 14,
        background: `${canvasTheme.bg}cc`,
        border: `1px solid ${canvasTheme.border}`,
        backdropFilter: 'blur(6px)',
        zIndex: 5,
      }}
    >
      {TOOLS.map((t) => {
        const active = t.enabled && t.tool === activeTool
        return (
          <button
            key={t.tool}
            type="button"
            aria-label={t.label}
            title={t.enabled ? t.label : `${t.label} (coming soon)`}
            onClick={() => t.enabled && onTool(t.tool)}
            disabled={!t.enabled}
            style={{
              width: 38,
              height: 38,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 10,
              border: active ? `1px solid ${canvasTheme.accent}` : '1px solid transparent',
              background: active ? `${canvasTheme.accent}1f` : 'transparent',
              color: !t.enabled ? canvasTheme.textMuted : active ? canvasTheme.accent : canvasTheme.text,
              opacity: t.enabled ? 1 : 0.4,
              cursor: t.enabled ? 'pointer' : 'default',
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            {t.glyph}
          </button>
        )
      })}
    </div>
  )
}
