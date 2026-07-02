'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'

/** Reference/source node: shows the attached asset thumbnail + a single output port. */
function SourceNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <BaseNodeCard type="source" title={d.title || 'Source'} selected={Boolean(selected)} actions={nodeActionsFor(d)}>
      {d.assetUrl ? (
        d.assetKind === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={d.assetUrl} style={{ display: 'block', width: '100%', maxHeight: 160, objectFit: 'cover' }} muted />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.assetUrl} alt={d.title} style={{ display: 'block', width: '100%', maxHeight: 160, objectFit: 'cover' }} />
        )
      ) : (
        <div style={{ padding: 16, fontSize: 12, color: canvasTheme.textMuted, textAlign: 'center' }}>
          Upload or link a reference
        </div>
      )}
    </BaseNodeCard>
  )
}

export default memo(SourceNodeComponent)
