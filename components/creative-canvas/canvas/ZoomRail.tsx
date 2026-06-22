'use client'

import { useReactFlow } from '@xyflow/react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

interface ZoomRailProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

function RailButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 34,
        height: 34,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 9,
        border: `1px solid ${canvasTheme.border}`,
        background: canvasTheme.surface,
        color: disabled ? canvasTheme.textMuted : canvasTheme.text,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 15,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  )
}

/** Left vertical rail: zoom in/out, fit, and undo/redo (history-backed). */
export default function ZoomRail({ canUndo, canRedo, onUndo, onRedo }: ZoomRailProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        bottom: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 6,
        borderRadius: 12,
        background: `${canvasTheme.bg}cc`,
        border: `1px solid ${canvasTheme.border}`,
        backdropFilter: 'blur(6px)',
        zIndex: 5,
      }}
    >
      <RailButton label="Zoom in" onClick={() => zoomIn()}>＋</RailButton>
      <RailButton label="Zoom out" onClick={() => zoomOut()}>－</RailButton>
      <RailButton label="Fit view" onClick={() => fitView({ duration: 200 })}>⤢</RailButton>
      <RailButton label="Undo" onClick={onUndo} disabled={!canUndo}>↶</RailButton>
      <RailButton label="Redo" onClick={onRedo} disabled={!canRedo}>↷</RailButton>
    </div>
  )
}
