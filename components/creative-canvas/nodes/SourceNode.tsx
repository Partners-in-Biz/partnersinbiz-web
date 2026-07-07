'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'

function formatTrimLabel(startSeconds: number, endSeconds: number) {
  return `✂ ${startSeconds.toFixed(1)}s–${endSeconds.toFixed(1)}s`
}

/** Reference/source node: shows the attached asset thumbnail + a single output port. */
function SourceNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const trim = d.canvasNode?.data?.trim as { startSeconds?: unknown; endSeconds?: unknown } | undefined
  const hasTrim = typeof trim?.startSeconds === 'number' && typeof trim?.endSeconds === 'number'
  return (
    <BaseNodeCard type="source" title={d.title || 'Source'} selected={Boolean(selected)} actions={nodeActionsFor(d)}>
      {hasTrim ? (
        <div style={{ padding: '6px 10px 0' }}>
          <span
            aria-label={`Video segment ${(trim!.startSeconds as number).toFixed(1)}s to ${(trim!.endSeconds as number).toFixed(1)}s`}
            data-tip="Only this clip is processed by edits"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              color: canvasTheme.text,
              background: canvasTheme.surfaceRaised,
              border: `1px solid ${canvasTheme.border}`,
            }}
          >
            {formatTrimLabel(trim!.startSeconds as number, trim!.endSeconds as number)}
          </span>
        </div>
      ) : null}
      {d.assetUrl ? (
        d.assetKind === 'video' ? (
          <video src={d.assetUrl} style={{ display: 'block', width: '100%', height: 160, objectFit: 'cover' }} muted />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.assetUrl} alt={d.title} style={{ display: 'block', width: '100%', height: 160, objectFit: 'cover' }} />
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
