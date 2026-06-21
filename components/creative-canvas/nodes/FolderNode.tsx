'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

/** A labeled group container that other nodes can be dropped into. */
function FolderNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <div
      style={{
        width: 220,
        minHeight: 140,
        borderRadius: canvasTheme.radius,
        background: `${canvasTheme.surface}aa`,
        border: `1px dashed ${selected ? canvasTheme.accent : canvasTheme.borderActive}`,
        color: canvasTheme.text,
        padding: 10,
      }}
    >
      <Handle id="out" type="source" position={Position.Right} style={{ width: 10, height: 10, background: canvasTheme.port.text }} />
      <div style={{ fontSize: 12, fontWeight: 600, color: canvasTheme.textMuted }}>📁 {d.title || 'Folder'}</div>
    </div>
  )
}

export default memo(FolderNodeComponent)
