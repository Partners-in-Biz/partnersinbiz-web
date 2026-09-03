'use client'

import { useEffect, useRef, useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

export interface VideoSegment {
  startSeconds: number
  endSeconds: number
}

export interface VideoSplitDialogProps {
  open: boolean
  videoUrl: string
  nodeTitle: string
  onClose: () => void
  onSplit: (segments: VideoSegment[]) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** Carve a video into segments so downstream edits/generation only process a
 *  short clip — providers charge by how much source footage they analyze. */
export default function VideoSplitDialog({ open, videoUrl, nodeTitle, onClose, onSplit }: VideoSplitDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [segments, setSegments] = useState<VideoSegment[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setSegments([])
      setStart(0)
      setEnd(0)
      setDuration(0)
      setError('')
    }
  }, [open, videoUrl])

  if (!open) return null

  const markFromPlayhead = (which: 'start' | 'end') => {
    const time = Math.round((videoRef.current?.currentTime ?? 0) * 10) / 10
    if (which === 'start') setStart(time)
    else setEnd(time)
  }

  const addSegment = () => {
    const clampedEnd = end || duration
    if (clampedEnd <= start) {
      setError('End must be after start')
      return
    }
    setError('')
    setSegments((current) => [...current, { startSeconds: start, endSeconds: clampedEnd }])
    setStart(clampedEnd)
    setEnd(0)
  }

  const numberInput = (value: number, onChange: (v: number) => void, label: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: canvasTheme.textMuted, fontWeight: 600 }}>
      {label}
      <input
        type="number"
        min={0}
        max={duration || undefined}
        step={0.1}
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        style={{ width: 84, background: canvasTheme.bg, border: `1px solid ${canvasTheme.border}`, borderRadius: 7, color: canvasTheme.text, fontSize: 13, padding: '5px 8px' }}
       aria-label="Number"/>
    </label>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Split video: ${nodeTitle}`}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(6, 8, 12, 0.66)' }}
      onClick={onClose}
    >
      <div
        style={{ width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', background: canvasTheme.surface, border: `1px solid ${canvasTheme.border}`, borderRadius: 14, boxShadow: canvasTheme.nodeShadow, color: canvasTheme.text, padding: 16 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700 }}>Split video</p>
            <p style={{ fontSize: 12, color: canvasTheme.textMuted }}>{nodeTitle}</p>
          </div>
          <button type="button" aria-label="Close split dialog" data-tip="Close" onClick={onClose} style={{ background: 'transparent', border: 'none', color: canvasTheme.textMuted, cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          preload="metadata"
          onLoadedMetadata={(event) => {
            const total = event.currentTarget.duration
            if (Number.isFinite(total)) {
              setDuration(Math.round(total * 10) / 10)
              setEnd((current) => current || Math.round(total * 10) / 10)
            }
          }}
          style={{ width: '100%', borderRadius: 10, background: '#000' }}
        />

        <p style={{ marginTop: 8, fontSize: 11, color: canvasTheme.textMuted }}>
          Editing providers charge for every second of source footage they analyze — a 4s clip costs a
          fraction of a full-length video. Carve out just the moment you want to work with.
          {duration ? ` Full length: ${formatTime(duration)}.` : ''}
        </p>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          {numberInput(start, setStart, 'Start (s)')}
          <button type="button" data-tip="Use current playhead as start" onClick={() => markFromPlayhead('start')} style={markBtn}>⤓ playhead</button>
          {numberInput(end, setEnd, 'End (s)')}
          <button type="button" data-tip="Use current playhead as end" onClick={() => markFromPlayhead('end')} style={markBtn}>⤓ playhead</button>
          <button
            type="button"
            onClick={addSegment}
            style={{ height: 30, padding: '0 12px', borderRadius: 8, border: `1px solid ${canvasTheme.accent}`, background: `${canvasTheme.accent}1f`, color: canvasTheme.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            + Add segment
          </button>
        </div>
        {error ? <p style={{ marginTop: 6, fontSize: 12, color: '#ff7a7a' }}>{error}</p> : null}

        {segments.length ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {segments.map((segment, index) => (
              <div key={`${segment.startSeconds}-${segment.endSeconds}-${index}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${canvasTheme.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                <span>
                  Segment {index + 1}: {formatTime(segment.startSeconds)} → {formatTime(segment.endSeconds)}
                  <span style={{ color: canvasTheme.textMuted }}> ({(segment.endSeconds - segment.startSeconds).toFixed(1)}s)</span>
                </span>
                <button type="button" aria-label={`Remove segment ${index + 1}`} data-tip="Remove segment" onClick={() => setSegments((current) => current.filter((_, i) => i !== index))} style={{ background: 'transparent', border: 'none', color: '#ff7a7a', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          disabled={!segments.length}
          onClick={() => onSplit(segments)}
          style={{ marginTop: 14, width: '100%', height: 38, borderRadius: 9, border: 'none', background: canvasTheme.accent, color: canvasTheme.accentText, fontWeight: 700, fontSize: 14, cursor: segments.length ? 'pointer' : 'default', opacity: segments.length ? 1 : 0.5 }}
        >
          Create {segments.length || ''} segment node{segments.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}

const markBtn: React.CSSProperties = {
  height: 30,
  padding: '0 10px',
  borderRadius: 8,
  border: `1px solid ${canvasTheme.border}`,
  background: canvasTheme.surfaceRaised,
  color: canvasTheme.textMuted,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
}
