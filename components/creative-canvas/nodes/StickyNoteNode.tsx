'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

/** A yellow sticky note with a single text output port. */
function StickyNoteNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <div
      style={{
        width: 200,
        minHeight: 120,
        borderRadius: 10,
        background: '#f4e07a',
        color: '#241f00',
        border: `1px solid ${selected ? canvasTheme.accent : '#d8c24e'}`,
        boxShadow: canvasTheme.nodeShadow,
        padding: 10,
      }}
    >
      <Handle id="out" type="source" position={Position.Right} style={{ width: 10, height: 10, background: canvasTheme.port.text }} />
      <textarea
        value={d.text ?? ''}
        onChange={(event) => d.onTextChange?.(event.target.value)}
        placeholder="Note…"
        rows={4}
        className="nodrag"
        style={{
          resize: 'none',
          width: '100%',
          background: 'transparent',
          border: 'none',
          color: '#241f00',
          fontSize: 13,
          outline: 'none',
        }}
      />
    </div>
  )
}

export default memo(StickyNoteNodeComponent)
