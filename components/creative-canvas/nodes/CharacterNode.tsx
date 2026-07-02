'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'

/**
 * Character node: identity card with an optional reference image (visual
 * identity slot), a "Soul" badge when the character is linked to a Soul ID
 * for identity-consistent generation, and an editable description.
 */
function CharacterNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const soulId = typeof d.soulId === 'string' ? d.soulId : ''
  return (
    <BaseNodeCard
      type="character"
      title={d.title || 'Character'}
      selected={Boolean(selected)}
      actions={nodeActionsFor(d)}
      headerRight={
        soulId ? (
          <span
            title={`Soul ID: ${soulId}`}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 999,
              border: `1px solid ${canvasTheme.border}`,
              background: canvasTheme.surfaceRaised,
              color: canvasTheme.accent,
              flexShrink: 0,
            }}
          >
            Soul
          </span>
        ) : undefined
      }
    >
      {d.assetUrl ? (
        <div style={{ background: canvasTheme.bg }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.assetUrl} alt={d.title} style={{ display: 'block', width: '100%', maxHeight: 160, objectFit: 'cover' }} />
        </div>
      ) : (
        <div style={{ padding: '10px 10px 0' }}>
          <button
            type="button"
            onClick={() => d.onAddReference?.()}
            className="nodrag"
            title="Add reference image"
            style={{
              width: '100%',
              height: 30,
              borderRadius: 8,
              border: `1px dashed ${canvasTheme.borderActive}`,
              background: 'transparent',
              color: canvasTheme.textMuted,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ＋ Add reference
          </button>
        </div>
      )}
      <div style={{ padding: 10 }}>
        <textarea
          value={d.text ?? ''}
          onChange={(event) => d.onTextChange?.(event.target.value)}
          placeholder="Describe the character…"
          rows={3}
          className="nodrag"
          style={{
            resize: 'none',
            width: '100%',
            background: canvasTheme.bg,
            border: `1px solid ${canvasTheme.border}`,
            borderRadius: 8,
            color: canvasTheme.text,
            fontSize: 12,
            padding: 8,
          }}
        />
      </div>
    </BaseNodeCard>
  )
}

export default memo(CharacterNodeComponent)
