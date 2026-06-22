'use client'

import { useMemo, useRef, useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

export interface ReferenceAsset {
  id: string
  url: string
  thumbnailUrl?: string
  title?: string
  kind: 'image' | 'video'
}

type ReferenceTab = 'Uploads' | 'Image Generations' | 'Video Generations' | 'Liked'

const TABS: ReferenceTab[] = [
  'Uploads',
  'Image Generations',
  'Video Generations',
  'Liked',
]

interface ReferencePickerProps {
  position: { x: number; y: number }
  uploads: ReferenceAsset[]
  imageGenerations: ReferenceAsset[]
  videoGenerations: ReferenceAsset[]
  liked?: ReferenceAsset[]
  onSelect: (asset: ReferenceAsset) => void
  onUploadNew: () => void
  onClose: () => void
}

const POPOVER_WIDTH = 340
const POPOVER_HEIGHT = 420

function AssetCard({
  asset,
  onSelect,
}: {
  asset: ReferenceAsset
  onSelect: (asset: ReferenceAsset) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(asset)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: 0,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span
        style={{
          display: 'block',
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: '10px',
          overflow: 'hidden',
          border: `1px solid ${canvasTheme.border}`,
          background: canvasTheme.bg,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.thumbnailUrl ?? asset.url}
          alt={asset.title ?? ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </span>
      {asset.title && (
        <span
          style={{
            fontSize: '11px',
            color: canvasTheme.textMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {asset.title}
        </span>
      )}
    </button>
  )
}

function EmptyState() {
  return (
    <p
      style={{
        gridColumn: '1 / -1',
        margin: 0,
        padding: '24px 8px',
        textAlign: 'center',
        fontSize: '13px',
        color: canvasTheme.textMuted,
      }}
    >
      No assets yet
    </p>
  )
}

export default function ReferencePicker({
  position,
  uploads,
  imageGenerations,
  videoGenerations,
  liked = [],
  onSelect,
  onUploadNew,
  onClose,
}: ReferencePickerProps) {
  const [tab, setTab] = useState<ReferenceTab>('Uploads')
  const popoverRef = useRef<HTMLDivElement>(null)

  const assets = useMemo<ReferenceAsset[]>(() => {
    switch (tab) {
      case 'Uploads':
        return uploads
      case 'Image Generations':
        return imageGenerations
      case 'Video Generations':
        return videoGenerations
      case 'Liked':
        return liked
      default:
        return []
    }
  }, [tab, uploads, imageGenerations, videoGenerations, liked])

  // Clamp so the popover stays on screen.
  const viewportWidth =
    typeof window !== 'undefined' ? window.innerWidth : POPOVER_WIDTH * 2
  const viewportHeight =
    typeof window !== 'undefined' ? window.innerHeight : POPOVER_HEIGHT * 2
  const left = Math.max(
    8,
    Math.min(position.x, viewportWidth - POPOVER_WIDTH - 8),
  )
  const top = Math.max(
    8,
    Math.min(position.y, viewportHeight - POPOVER_HEIGHT - 8),
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 40 }}
      onClick={onClose}
    >
      <div
        ref={popoverRef}
        role="dialog"
        aria-label="Attach reference"
        tabIndex={-1}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        style={{
          position: 'absolute',
          left,
          top,
          width: POPOVER_WIDTH,
          maxHeight: POPOVER_HEIGHT,
          zIndex: 41,
          display: 'flex',
          flexDirection: 'column',
          background: canvasTheme.surface,
          border: `1px solid ${canvasTheme.border}`,
          borderRadius: canvasTheme.radius,
          boxShadow: canvasTheme.nodeShadow,
          color: canvasTheme.text,
          outline: 'none',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderBottom: `1px solid ${canvasTheme.border}`,
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 600 }}>
            Add reference
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: canvasTheme.textMuted,
              cursor: 'pointer',
              fontSize: '16px',
              lineHeight: 1,
              padding: '2px 4px',
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: '4px',
            padding: '8px 12px',
            borderBottom: `1px solid ${canvasTheme.border}`,
            overflowX: 'auto',
          }}
        >
          {TABS.map((t) => {
            const active = t === tab
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                style={{
                  flex: '0 0 auto',
                  padding: '5px 9px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  background: active
                    ? canvasTheme.surfaceRaised
                    : 'transparent',
                  color: active ? canvasTheme.text : canvasTheme.textMuted,
                  border: `1px solid ${active ? canvasTheme.borderActive : 'transparent'}`,
                }}
              >
                {t}
              </button>
            )
          })}
        </div>

        {/* Grid */}
        <div
          style={{
            padding: '12px',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
            }}
          >
            {tab === 'Uploads' && (
              <button
                type="button"
                onClick={onUploadNew}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  aspectRatio: '1 / 1',
                  borderRadius: '10px',
                  border: `1px dashed ${canvasTheme.borderActive}`,
                  background: canvasTheme.bg,
                  color: canvasTheme.textMuted,
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                <span aria-hidden style={{ fontSize: '20px', lineHeight: 1 }}>
                  +
                </span>
                <span>Upload media</span>
              </button>
            )}

            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} onSelect={onSelect} />
            ))}

            {assets.length === 0 && tab !== 'Uploads' && <EmptyState />}
          </div>
        </div>
      </div>
    </div>
  )
}
