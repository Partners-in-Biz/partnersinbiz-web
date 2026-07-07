'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'

function TextNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <BaseNodeCard type="text" title={d.title || 'Text'} selected={Boolean(selected)} actions={nodeActionsFor(d)}>
      <div style={{ padding: 10 }}>
        <textarea
          value={d.text ?? ''}
          onChange={(event) => d.onTextChange?.(event.target.value)}
          placeholder="Type text…"
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

export default memo(TextNodeComponent)
