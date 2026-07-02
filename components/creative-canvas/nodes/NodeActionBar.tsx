'use client'

import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

export interface NodeActionBarProps {
  onDelete?: () => void
  onDuplicate?: () => void
  onEditWithAi?: () => void
  onReplaceContent?: () => void
  onPublish?: () => void
  downloadUrl?: string
}

const actionButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 6,
  border: `1px solid ${canvasTheme.border}`,
  background: canvasTheme.surfaceRaised,
  color: canvasTheme.text,
  cursor: 'pointer',
  fontSize: 11,
  lineHeight: 1,
  padding: 0,
  flexShrink: 0,
}

/** Compact per-node action strip rendered in the node card header. */
export default function NodeActionBar({ onDelete, onDuplicate, onEditWithAi, onReplaceContent, onPublish, downloadUrl }: NodeActionBarProps) {
  if (!onDelete && !onDuplicate && !onEditWithAi && !onReplaceContent && !onPublish && !downloadUrl) return null
  return (
    <span className="nodrag" style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {onEditWithAi ? (
        <button type="button" title="Edit with AI" aria-label="Edit with AI" style={actionButtonStyle} onClick={(event) => { event.stopPropagation(); onEditWithAi() }}>✨</button>
      ) : null}
      {onReplaceContent ? (
        <button type="button" title="Replace content" aria-label="Replace content" style={actionButtonStyle} onClick={(event) => { event.stopPropagation(); onReplaceContent() }}>⇄</button>
      ) : null}
      {onPublish ? (
        <button type="button" title="Publish to platform" aria-label="Publish node" style={actionButtonStyle} onClick={(event) => { event.stopPropagation(); onPublish() }}>📤</button>
      ) : null}
      {onDuplicate ? (
        <button type="button" title="Duplicate" aria-label="Duplicate node" style={actionButtonStyle} onClick={(event) => { event.stopPropagation(); onDuplicate() }}>⧉</button>
      ) : null}
      {downloadUrl ? (
        <a title="Open media" aria-label="Open media" style={{ ...actionButtonStyle, textDecoration: 'none' }} href={downloadUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>↓</a>
      ) : null}
      {onDelete ? (
        <button type="button" title="Delete" aria-label="Delete node" style={{ ...actionButtonStyle, color: '#ff7a7a' }} onClick={(event) => { event.stopPropagation(); onDelete() }}>✕</button>
      ) : null}
    </span>
  )
}

/** Build the action bar element from React Flow node data (shared by all node cards). */
export function nodeActionsFor(data: CanvasNodeData): React.ReactNode {
  const { onDelete, onDuplicate, onEditWithAi, onReplaceContent, onPublish, downloadUrl } = data
  if (!onDelete && !onDuplicate && !onEditWithAi && !onReplaceContent && !onPublish && !downloadUrl) return null
  return (
    <NodeActionBar
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onEditWithAi={onEditWithAi}
      onReplaceContent={onReplaceContent}
      onPublish={onPublish}
      downloadUrl={downloadUrl}
    />
  )
}
