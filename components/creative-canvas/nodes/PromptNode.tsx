'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

/** Prompt / translate node: an editable text block with text in/out ports. */
function PromptNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const type = d.presentationType === 'translate' ? 'translate' : 'prompt'
  return (
    <BaseNodeCard type={type} title={d.title} selected={Boolean(selected)}>
      <div style={{ padding: 10 }}>
        <textarea
          value={d.text ?? d.prompt ?? ''}
          onChange={(event) => (d.onTextChange ?? d.onPromptChange)?.(event.target.value)}
          placeholder="Write a prompt…"
          rows={4}
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

export default memo(PromptNodeComponent)
