'use client'

import { useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeType } from '@/components/creative-canvas/nodes/ports'
import { createMenuGroups } from '@/components/creative-canvas/canvas/createMenuItems'

interface CreateMenuProps {
  position: { x: number; y: number }
  onCreate: (type: CanvasNodeType, mode?: string) => void
  onClose: () => void
}

export default function CreateMenu({ position, onCreate, onClose }: CreateMenuProps) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const filteredGroups = createMenuGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => item.label.toLowerCase().includes(q)),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: position.x,
          top: position.y,
          zIndex: 41,
          width: 240,
          background: canvasTheme.surface,
          border: `1px solid ${canvasTheme.border}`,
          borderRadius: canvasTheme.radius,
          boxShadow: canvasTheme.nodeShadow,
          color: canvasTheme.text,
          padding: 8,
          maxHeight: 420,
          overflowY: 'auto',
        }}
      >
        <input
          autoFocus
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: canvasTheme.bg,
            border: `1px solid ${canvasTheme.border}`,
            borderRadius: 8,
            color: canvasTheme.text,
            padding: '8px 10px',
            fontSize: 13,
            outline: 'none',
            marginBottom: 6,
          }}
        />
        {filteredGroups.map((g) => (
          <div key={g.group || '_default'} style={{ marginBottom: 4 }}>
            {g.group ? (
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: canvasTheme.textMuted,
                  padding: '6px 8px 2px',
                }}
              >
                {g.group}
              </div>
            ) : null}
            {g.items.map((item) => (
              <button
                key={`${item.type}:${item.mode ?? ''}`}
                type="button"
                onClick={() => onCreate(item.type, item.mode)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: canvasTheme.text,
                  padding: '7px 8px',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = canvasTheme.surfaceRaised
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
