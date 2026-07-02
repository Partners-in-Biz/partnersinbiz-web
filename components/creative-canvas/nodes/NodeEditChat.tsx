'use client'

import { useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

export type NodeEditPlacement = 'branch' | 'replace'

export interface NodeEditChatProps {
  nodeTitle: string
  /** What kind of content the edit produces (drives the helper copy). */
  mediaKind: 'image' | 'video' | 'text'
  busy?: boolean
  error?: string
  onSubmit: (prompt: string, placement: NodeEditPlacement) => void
  onClose: () => void
}

/**
 * Inline AI edit popover: describe how the node should change, choose whether
 * the result branches into a new linked node or replaces this one.
 */
export default function NodeEditChat({ nodeTitle, mediaKind, busy = false, error, onSubmit, onClose }: NodeEditChatProps) {
  const [prompt, setPrompt] = useState('')
  const [placement, setPlacement] = useState<NodeEditPlacement>('branch')

  const submit = () => {
    if (!prompt.trim() || busy) return
    onSubmit(prompt.trim(), placement)
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div
        role="dialog"
        aria-label={`Edit ${nodeTitle} with AI`}
        style={{
          position: 'fixed',
          left: '50%',
          top: 120,
          transform: 'translateX(-50%)',
          width: 380,
          zIndex: 41,
          borderRadius: 14,
          background: canvasTheme.surface,
          border: `1px solid ${canvasTheme.border}`,
          boxShadow: canvasTheme.nodeShadow,
          color: canvasTheme.text,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>✨ Edit “{nodeTitle}”</span>
          <button type="button" aria-label="Close AI edit" onClick={onClose} style={{ border: 'none', background: 'transparent', color: canvasTheme.textMuted, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={mediaKind === 'text'
            ? 'How should this text change? e.g. make it punchier, translate to Afrikaans…'
            : `How should this ${mediaKind} change? e.g. put the subject on a beach at sunset…`}
          rows={3}
          autoFocus
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
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div role="radiogroup" aria-label="Result placement" style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${canvasTheme.border}` }}>
            {(['branch', 'replace'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={placement === option}
                onClick={() => setPlacement(option)}
                title={option === 'branch' ? 'Result becomes a new node linked from this one' : 'Result takes this node’s place (old version stays in history)'}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  border: 'none',
                  cursor: 'pointer',
                  background: placement === option ? canvasTheme.surfaceRaised : 'transparent',
                  color: placement === option ? canvasTheme.text : canvasTheme.textMuted,
                }}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !prompt.trim()}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 9,
              border: 'none',
              background: canvasTheme.accent,
              color: canvasTheme.accentText,
              fontWeight: 700,
              fontSize: 13,
              cursor: busy || !prompt.trim() ? 'default' : 'pointer',
              opacity: busy || !prompt.trim() ? 0.6 : 1,
            }}
          >
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {error ? <p style={{ margin: 0, fontSize: 12, color: '#ff7a7a' }}>{error}</p> : null}
      </div>
    </>
  )
}
