'use client'

import { Handle, Position } from '@xyflow/react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import { portsForNode, type CanvasNodeType } from '@/components/creative-canvas/nodes/ports'

export type CanvasNodeStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface GeneratorNodeCardProps {
  type: CanvasNodeType
  title: string
  prompt?: string
  model?: string
  creditCost?: number
  batch?: number
  assetUrl?: string
  assetKind?: 'image' | 'video'
  status?: CanvasNodeStatus
  selected?: boolean
  /** Generator nodes show the inline prompt + model + Generate bar; utility nodes do not. */
  showGenerateBar?: boolean
  onPromptChange?: (value: string) => void
  onBatchChange?: (next: number) => void
  onOpenModelPicker?: () => void
  onGenerate?: () => void
  children?: React.ReactNode
}

const statusLabel: Record<CanvasNodeStatus, string> = {
  idle: '',
  queued: 'Queued…',
  running: 'Generating…',
  done: '',
  error: 'Failed',
}

/** Renders the typed input/output handles for a node, colored + staggered by kind. */
export function NodeHandles({ type }: { type: CanvasNodeType }) {
  const { inputs, output } = portsForNode(type)
  return (
    <>
      {inputs.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{
            top: inputs.length === 1 ? '50%' : `${((index + 1) / (inputs.length + 1)) * 100}%`,
            width: 10,
            height: 10,
            background: canvasTheme.port[port.kind],
            border: `2px solid ${canvasTheme.bg}`,
          }}
        />
      ))}
      <Handle
        id={output.id}
        type="source"
        position={Position.Right}
        style={{
          top: '50%',
          width: 10,
          height: 10,
          background: canvasTheme.port[output.kind],
          border: `2px solid ${canvasTheme.bg}`,
        }}
      />
    </>
  )
}

/** Shared Higgsfield-style node card. Presentational: all state comes from props. */
export function GeneratorNodeCard(props: GeneratorNodeCardProps) {
  const {
    type,
    title,
    prompt = '',
    model,
    creditCost,
    batch = 1,
    assetUrl,
    assetKind,
    status = 'idle',
    selected = false,
    showGenerateBar = false,
    onPromptChange,
    onBatchChange,
    onOpenModelPicker,
    onGenerate,
    children,
  } = props

  const busy = status === 'queued' || status === 'running'

  return (
    <div
      style={{
        width: 260,
        borderRadius: canvasTheme.radius,
        background: canvasTheme.surface,
        border: `1px solid ${selected ? canvasTheme.accent : canvasTheme.border}`,
        boxShadow: selected ? canvasTheme.accentGlow : canvasTheme.nodeShadow,
        color: canvasTheme.text,
        overflow: 'hidden',
      }}
    >
      <NodeHandles type={type} />

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
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {status !== 'idle' && status !== 'done' ? (
          <span style={{ color: status === 'error' ? '#ff6b6b' : canvasTheme.accent }}>{statusLabel[status]}</span>
        ) : null}
      </div>

      {assetUrl ? (
        <div style={{ background: canvasTheme.bg }}>
          {assetKind === 'video' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={assetUrl} style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'cover' }} muted />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl} alt={title} style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'cover' }} />
          )}
        </div>
      ) : null}

      {children}

      {showGenerateBar ? (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange?.(event.target.value)}
            placeholder="Describe what you want to create…"
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <button
              type="button"
              onClick={onOpenModelPicker}
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
              {model ?? 'Select model'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                type="button"
                aria-label="Decrease batch"
                onClick={() => onBatchChange?.(Math.max(1, batch - 1))}
                className="nodrag"
                style={stepBtn}
              >
                −
              </button>
              <span style={{ width: 18, textAlign: 'center', fontSize: 12 }}>{batch}</span>
              <button
                type="button"
                aria-label="Increase batch"
                onClick={() => onBatchChange?.(Math.min(4, batch + 1))}
                className="nodrag"
                style={stepBtn}
              >
                +
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onGenerate}
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
            {busy ? 'Generating…' : `Generate${typeof creditCost === 'number' ? `  ✦ ${creditCost}` : ''}`}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Minimal card chrome (handles + title bar + body) for non-generator nodes. */
export function BaseNodeCard({
  type,
  title,
  selected = false,
  accent,
  width = 240,
  headerRight,
  children,
}: {
  type: CanvasNodeType
  title: string
  selected?: boolean
  accent?: string
  width?: number
  headerRight?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div
      style={{
        width,
        borderRadius: canvasTheme.radius,
        background: accent ?? canvasTheme.surface,
        border: `1px solid ${selected ? canvasTheme.accent : canvasTheme.border}`,
        boxShadow: selected ? canvasTheme.accentGlow : canvasTheme.nodeShadow,
        color: canvasTheme.text,
        overflow: 'hidden',
      }}
    >
      <NodeHandles type={type} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 10px',
          borderBottom: `1px solid ${canvasTheme.border}`,
          fontSize: 12,
          fontWeight: 600,
          color: canvasTheme.textMuted,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {headerRight}
      </div>
      {children}
    </div>
  )
}

const stepBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 6,
  border: `1px solid ${canvasTheme.border}`,
  background: canvasTheme.surfaceRaised,
  color: canvasTheme.text,
  cursor: 'pointer',
  fontSize: 13,
}
