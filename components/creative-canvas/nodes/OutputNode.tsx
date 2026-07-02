'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'

const reviewPillColor: Record<string, string> = {
  passed: '#3ddc97',
  needed: canvasTheme.accent,
  warning: '#ffb547',
  blocked: '#ff6b6b',
}

/** Output node: rendered asset + a review-status pill (tucked enterprise affordance). */
function OutputNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const review = d.reviewStatus
  return (
    <BaseNodeCard
      type="output"
      title={d.title || 'Output'}
      selected={Boolean(selected)}
      actions={nodeActionsFor(d)}
      headerRight={
        review && review !== 'not_required' ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 6,
              color: canvasTheme.accentText,
              background: reviewPillColor[review] ?? canvasTheme.textMuted,
            }}
          >
            {review}
          </span>
        ) : null
      }
    >
      {d.assetUrl ? (
        d.assetKind === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={d.assetUrl} style={{ display: 'block', width: '100%', maxHeight: 200, objectFit: 'cover' }} controls />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.assetUrl} alt={d.title} style={{ display: 'block', width: '100%', maxHeight: 200, objectFit: 'cover' }} />
        )
      ) : (
        <div style={{ padding: 16, fontSize: 12, color: canvasTheme.textMuted, textAlign: 'center' }}>
          {d.text ? d.text : 'No output yet'}
        </div>
      )}
    </BaseNodeCard>
  )
}

export default memo(OutputNodeComponent)
