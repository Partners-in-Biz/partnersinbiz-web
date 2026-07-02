'use client'

import { useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

export type NodePublishTarget = 'social_draft' | 'campaign_asset' | 'client_document' | 'blog_post' | 'workspace_artifact'

export type NodePublishPlatform = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'tiktok' | 'pinterest' | 'bluesky'

const PLATFORMS: Array<{ id: NodePublishPlatform; label: string }> = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitter', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'pinterest', label: 'Pinterest' },
  { id: 'bluesky', label: 'Bluesky' },
]

export interface NodePublishMenuProps {
  nodeTitle: string
  busy?: boolean
  error?: string
  /** Set after a successful publish — shown with a done state. */
  successMessage?: string
  onPublish: (target: NodePublishTarget, caption: string, platforms: NodePublishPlatform[]) => void
  onClose: () => void
}

const TARGETS: Array<{ target: NodePublishTarget; label: string; description: string }> = [
  { target: 'social_draft', label: 'Social draft', description: 'Creates a draft post in Marketing Studio (approve + schedule there)' },
  { target: 'campaign_asset', label: 'Campaign asset', description: 'Attaches to the linked campaign as a reviewable asset' },
  { target: 'client_document', label: 'Client document', description: 'Creates a client-document draft from this output' },
  { target: 'blog_post', label: 'Blog post', description: 'Creates a blog draft for the insights pipeline' },
  { target: 'workspace_artifact', label: 'Org vault', description: 'Saves into the organisation workspace artifacts' },
]

/**
 * Publish popover for output-bearing nodes: pick where this result should
 * land in the platform. Social drafts become real Marketing Studio posts;
 * the other targets create linked export drafts for their modules.
 */
export default function NodePublishMenu({ nodeTitle, busy = false, error, successMessage, onPublish, onClose }: NodePublishMenuProps) {
  const [target, setTarget] = useState<NodePublishTarget>('social_draft')
  const [caption, setCaption] = useState('')
  const [platforms, setPlatforms] = useState<NodePublishPlatform[]>(['instagram'])

  const togglePlatform = (id: NodePublishPlatform) => {
    setPlatforms((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }
  const publishDisabled = busy || (target === 'social_draft' && platforms.length === 0)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div
        role="dialog"
        aria-label={`Publish ${nodeTitle}`}
        style={{
          position: 'fixed',
          left: '50%',
          top: 110,
          transform: 'translateX(-50%)',
          width: 400,
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
          <span style={{ fontSize: 12, fontWeight: 700 }}>📤 Publish “{nodeTitle}”</span>
          <button type="button" aria-label="Close publish menu" onClick={onClose} style={{ border: 'none', background: 'transparent', color: canvasTheme.textMuted, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <div role="radiogroup" aria-label="Publish target" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {TARGETS.map((option) => (
            <button
              key={option.target}
              type="button"
              role="radio"
              aria-checked={target === option.target}
              onClick={() => setTarget(option.target)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 9,
                cursor: 'pointer',
                border: `1px solid ${target === option.target ? canvasTheme.accent : canvasTheme.border}`,
                background: target === option.target ? canvasTheme.surfaceRaised : 'transparent',
                color: canvasTheme.text,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>{option.label}</span>
              <span style={{ fontSize: 11, color: canvasTheme.textMuted }}>{option.description}</span>
            </button>
          ))}
        </div>

        {target === 'social_draft' ? (
          <div role="group" aria-label="Platforms" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {PLATFORMS.map((platform) => (
              <button
                key={platform.id}
                type="button"
                aria-pressed={platforms.includes(platform.id)}
                onClick={() => togglePlatform(platform.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: `1px solid ${platforms.includes(platform.id) ? canvasTheme.accent : canvasTheme.border}`,
                  background: platforms.includes(platform.id) ? canvasTheme.surfaceRaised : 'transparent',
                  color: platforms.includes(platform.id) ? canvasTheme.text : canvasTheme.textMuted,
                }}
              >
                {platform.label}
              </button>
            ))}
          </div>
        ) : null}

        {target === 'social_draft' ? (
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Caption (optional — the node prompt is used if empty)"
            rows={2}
            aria-label="Social caption"
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
        ) : null}

        <button
          type="button"
          onClick={() => onPublish(target, caption.trim(), platforms)}
          disabled={publishDisabled}
          style={{
            height: 34,
            borderRadius: 9,
            border: 'none',
            background: canvasTheme.accent,
            color: canvasTheme.accentText,
            fontWeight: 700,
            fontSize: 13,
            cursor: publishDisabled ? 'default' : 'pointer',
            opacity: publishDisabled ? 0.6 : 1,
          }}
        >
          {busy ? 'Publishing…' : 'Publish'}
        </button>

        {successMessage ? <p style={{ margin: 0, fontSize: 12, color: '#3ddc97' }}>{successMessage}</p> : null}
        {error ? <p style={{ margin: 0, fontSize: 12, color: '#ff7a7a' }}>{error}</p> : null}
      </div>
    </>
  )
}
