'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'

/**
 * Website/app-planning screen node: a page/screen card with an editable
 * description and an optional mockup image. Sitemap-style structure is
 * expressed by drawing plain edges between screen nodes.
 */
function ScreenNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <BaseNodeCard type="screen" title={d.title || 'Screen'} selected={Boolean(selected)} actions={nodeActionsFor(d)}>
      {d.assetUrl ? (
        <div style={{ background: canvasTheme.bg }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.assetUrl} alt={d.title} style={{ display: 'block', width: '100%', maxHeight: 160, objectFit: 'cover' }} />
        </div>
      ) : null}
      <div style={{ padding: 10 }}>
        <textarea
          value={d.text ?? ''}
          onChange={(event) => d.onTextChange?.(event.target.value)}
          placeholder="Describe this screen — purpose, content, key elements…"
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

export default memo(ScreenNodeComponent)
