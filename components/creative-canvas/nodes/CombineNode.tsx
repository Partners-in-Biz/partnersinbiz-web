'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import { NodeHandles, type CanvasNodeStatus } from '@/components/creative-canvas/nodes/nodeFactory'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'

const statusLabel: Record<CanvasNodeStatus, string> = {
  idle: '',
  queued: 'Queued…',
  running: 'Generating…',
  done: '',
  error: 'Failed',
}

/**
 * Combine node — the heart of the freeform canvas. Link any image / text /
 * video / audio nodes into it, write one instruction describing how they come
 * together ("the person wears these clothes, the dog sits next to them"),
 * pick an output type, and Generate. The result lands in a new output node
 * wired from this one.
 */
function CombineNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const status = (d.status ?? 'idle') as CanvasNodeStatus
  const busy = status === 'queued' || status === 'running'
  const outputKind = (typeof d.outputKind === 'string' ? d.outputKind : 'image') as 'image' | 'video'
  const inputCount = typeof d.inputCount === 'number' ? d.inputCount : 0
  const inputPreviews = Array.isArray(d.inputPreviews) ? (d.inputPreviews as string[]) : []
  const onOutputKindChange = d.onOutputKindChange as ((kind: 'image' | 'video') => void) | undefined

  return (
    <div
      style={{
        width: 360,
        borderRadius: canvasTheme.radius,
        background: canvasTheme.surface,
        border: `1px solid ${selected ? canvasTheme.accent : canvasTheme.border}`,
        boxShadow: selected ? canvasTheme.accentGlow : canvasTheme.nodeShadow,
        color: canvasTheme.text,
        overflow: 'hidden',
      }}
    >
      <NodeHandles type="combine" />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: `1px solid ${canvasTheme.border}`,
          fontSize: 12,
          fontWeight: 600,
          color: canvasTheme.textMuted,
        }}
      >
        <span>{d.title || 'Combine'}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {status !== 'idle' && status !== 'done' ? (
            <span style={{ color: status === 'error' ? '#ff6b6b' : canvasTheme.accent }}>{statusLabel[status]}</span>
          ) : null}
          {nodeActionsFor(d)}
        </span>
      </div>

      {d.assetUrl ? (
        <div style={{ background: canvasTheme.bg }}>
          {d.assetKind === 'video' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={d.assetUrl} style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'cover' }} muted />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.assetUrl} alt={d.title} style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'cover' }} />
          )}
        </div>
      ) : null}

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 24 }}>
          {inputPreviews.slice(0, 6).map((url, index) => (
            <span
              key={`${url}-${index}`}
              style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', border: `1px solid ${canvasTheme.border}`, flexShrink: 0, background: canvasTheme.bg }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Linked input ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </span>
          ))}
          <span style={{ fontSize: 11, color: canvasTheme.textMuted }}>
            {inputCount === 0
              ? 'Link image, text or video nodes into this node'
              : `${inputCount} linked input${inputCount === 1 ? '' : 's'}`}
          </span>
        </div>

        <textarea
          value={d.prompt ?? ''}
          onChange={(event) => d.onPromptChange?.(event.target.value)}
          placeholder="Describe how the linked nodes come together…"
          rows={4}
          className="nodrag"
          style={{
            resize: 'none',
            width: '100%',
            background: canvasTheme.bg,
            border: `1px solid ${canvasTheme.border}`,
            borderRadius: 8,
            color: canvasTheme.text,
            fontSize: 13,
            padding: 10,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${canvasTheme.border}` }}>
            {(['image', 'video'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onOutputKindChange?.(kind)}
                className="nodrag"
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  border: 'none',
                  cursor: 'pointer',
                  background: outputKind === kind ? canvasTheme.surfaceRaised : 'transparent',
                  color: outputKind === kind ? canvasTheme.text : canvasTheme.textMuted,
                }}
              >
                {kind}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={d.onOpenModelPicker}
            className="nodrag"
            style={{
              flex: 1,
              minWidth: 0,
              height: 30,
              borderRadius: 8,
              border: `1px solid ${canvasTheme.border}`,
              background: canvasTheme.surfaceRaised,
              color: canvasTheme.text,
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {d.model ?? 'Select model'}
          </button>
        </div>

        <button
          type="button"
          onClick={d.onGenerate}
          disabled={busy}
          className="nodrag"
          style={{
            height: 34,
            borderRadius: 9,
            border: 'none',
            background: canvasTheme.accent,
            color: canvasTheme.accentText,
            fontWeight: 700,
            fontSize: 13,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Generating…' : `Generate ${outputKind}${typeof d.creditCost === 'number' ? `  ✦ ${d.creditCost}` : ''}`}
        </button>
      </div>
    </div>
  )
}

export default memo(CombineNodeComponent)
