'use client'

import { useEffect, useState } from 'react'
import type { EditorTimeline, EditorTrackKind } from '@/lib/video-editor/types'

export interface TimelineSelection {
  trackId: string
  clipIds: string[]
}

const TRIM_COMMIT_THRESHOLD_SECONDS = 0.05
const TRIM_KEY_STEP_SECONDS = 0.1
const TRIM_KEY_STEP_LARGE_SECONDS = 1

interface TrimDragState {
  trackId: string
  clipId: string
  edge: 'start' | 'end'
  originClientX: number
  deltaSeconds: number
}

interface TimelinePanelProps {
  timeline: EditorTimeline
  selection: TimelineSelection | null
  playheadSeconds: number
  pxPerSecond: number
  onSelectionChange: (selection: TimelineSelection | null) => void
  onSeek: (seconds: number) => void
  onZoomChange: (pxPerSecond: number) => void
  onMoveClip: (trackId: string, clipId: string, toStart: number) => void
  onTrimClip: (trackId: string, clipId: string, edge: 'start' | 'end', deltaSeconds: number) => void
  onSplitAtPlayhead: () => void
  onRemoveSelected: () => void
  onToggleTrackFlag: (trackId: string, flag: 'muted' | 'locked') => void
  onAddTrack: (kind: EditorTrackKind) => void
  onAddTextClip: () => void
}

export function snapSeconds(target: number, candidates: number[], threshold = 0.2): number {
  const nearest = candidates.reduce<{ value: number; distance: number } | null>((best, candidate) => {
    const distance = Math.abs(candidate - target)
    if (distance > threshold) return best
    if (!best || distance < best.distance) return { value: candidate, distance }
    return best
  }, null)
  return Math.max(0, nearest?.value ?? target)
}

export function TimelinePanel({
  timeline,
  selection,
  playheadSeconds,
  pxPerSecond,
  onSelectionChange,
  onSeek,
  onZoomChange,
  onMoveClip,
  onTrimClip,
  onSplitAtPlayhead,
  onRemoveSelected,
  onToggleTrackFlag,
  onAddTrack,
  onAddTextClip,
}: TimelinePanelProps) {
  const duration = Math.max(30, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clip.duration)))
  const rulerTicks = Array.from({ length: Math.ceil(duration / 5) + 1 }, (_, index) => index * 5)
  const snapCandidates = timeline.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.timelineStart, clip.timelineStart + clip.duration]))

  const [trimDrag, setTrimDrag] = useState<TrimDragState | null>(null)

  useEffect(() => {
    if (!trimDrag) return
    const handleMove = (event: PointerEvent) => {
      setTrimDrag((current) => current
        ? { ...current, deltaSeconds: (event.clientX - current.originClientX) / pxPerSecond }
        : current)
    }
    const handleUp = (event: PointerEvent) => {
      const deltaSeconds = (event.clientX - trimDrag.originClientX) / pxPerSecond
      setTrimDrag(null)
      if (Math.abs(deltaSeconds) >= TRIM_COMMIT_THRESHOLD_SECONDS) {
        onTrimClip(trimDrag.trackId, trimDrag.clipId, trimDrag.edge, Math.round(deltaSeconds * 1000) / 1000)
      }
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [trimDrag, pxPerSecond, onTrimClip])

  function handleTrimKeyDown(event: React.KeyboardEvent, trackId: string, clipId: string, edge: 'start' | 'end') {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? TRIM_KEY_STEP_LARGE_SECONDS : TRIM_KEY_STEP_SECONDS
    onTrimClip(trackId, clipId, edge, event.key === 'ArrowLeft' ? -step : step)
  }

  return (
    <section className="pib-card-section overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-pib-line)] p-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="pib-btn-ghost text-sm" onClick={onSplitAtPlayhead} aria-label="Split at playhead">
            <span className="material-symbols-rounded text-base">content_cut</span>
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={onRemoveSelected} aria-label="Delete selected">
            <span className="material-symbols-rounded text-base">delete</span>
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={() => onZoomChange(Math.min(180, Math.round(pxPerSecond * 1.25)))} aria-label="Zoom in">
            <span className="material-symbols-rounded text-base">zoom_in</span>
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={() => onZoomChange(Math.max(20, Math.round(pxPerSecond / 1.25)))} aria-label="Zoom out">
            <span className="material-symbols-rounded text-base">zoom_out</span>
          </button>
        </div>
        <label className="text-sm text-on-surface-variant">
          Add to timeline
          <select
            className="ml-2 rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return
              if (event.target.value === 'text') onAddTextClip()
              else onAddTrack(event.target.value as EditorTrackKind)
              event.target.value = ''
            }}
          >
            <option value="">Choose</option>
            <option value="video">Video track</option>
            <option value="overlay">Overlay track</option>
            <option value="text">Text title clip</option>
            <option value="audio">Audio track</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <div style={{ width: `${duration * pxPerSecond + 220}px` }} className="min-w-full">
          <div className="flex border-b border-[var(--color-pib-line)] text-xs text-on-surface-variant">
            <div className="w-48 shrink-0 p-2">Timeline</div>
            <div
              data-testid="timeline-ruler"
              className="relative h-8 flex-1 cursor-pointer"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                onSeek(Math.max(0, (event.clientX - rect.left) / pxPerSecond))
              }}
            >
              {rulerTicks.map((tick) => (
                <span key={tick} style={{ left: `${tick * pxPerSecond}px` }} className="absolute top-2">
                  {tick}s
                </span>
              ))}
              <span style={{ left: `${playheadSeconds * pxPerSecond}px` }} className="absolute inset-y-0 w-px bg-[var(--color-pib-primary)]" />
            </div>
          </div>
          {timeline.tracks.map((track) => (
            <div key={track.id} className="flex border-b border-[var(--color-pib-line)]">
              <div className="w-48 shrink-0 space-y-2 p-2">
                <p className="truncate text-sm font-medium text-on-surface">{track.label || track.kind}</p>
                <div className="flex gap-1">
                  <button type="button" className="rounded border border-[var(--color-pib-line)] px-2 py-1 text-xs" onClick={() => onToggleTrackFlag(track.id, 'muted')} aria-label={`Mute ${track.label || track.kind}`}>
                    M
                  </button>
                  <button type="button" className="rounded border border-[var(--color-pib-line)] px-2 py-1 text-xs" onClick={() => onToggleTrackFlag(track.id, 'locked')} aria-label={`Lock ${track.label || track.kind}`}>
                    L
                  </button>
                </div>
              </div>
              <div className="relative h-20 flex-1">
                {track.clips.map((clip) => {
                  const selected = selection?.trackId === track.id && selection.clipIds.includes(clip.id)
                  const isDraggingThisClip = trimDrag?.trackId === track.id && trimDrag.clipId === clip.id
                  const startPreview = isDraggingThisClip && trimDrag.edge === 'start' ? trimDrag.deltaSeconds : 0
                  const endPreview = isDraggingThisClip && trimDrag.edge === 'end' ? trimDrag.deltaSeconds : 0
                  const left = (clip.timelineStart + startPreview) * pxPerSecond
                  const width = Math.max(8, (clip.duration - startPreview + endPreview) * pxPerSecond)
                  const clipLabel = clip.text?.content || clip.media?.mediaKind || clip.id
                  return (
                    <div
                      key={clip.id}
                      data-testid={`timeline-clip-${clip.id}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Clip ${clipLabel}`}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      className={[
                        'group absolute top-3 h-12 overflow-hidden rounded-md border px-2 text-left text-xs',
                        selected ? 'border-[var(--color-pib-primary)] bg-[var(--color-pib-primary)]/20 text-on-surface' : 'border-[var(--color-pib-line)] bg-white/[0.04] text-on-surface-variant',
                      ].join(' ')}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelectionChange({ trackId: track.id, clipIds: [clip.id] })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectionChange({ trackId: track.id, clipIds: [clip.id] })
                        }
                      }}
                      onDoubleClick={() => onMoveClip(track.id, clip.id, snapSeconds(clip.timelineStart + 1, snapCandidates))}
                    >
                      <span className="block truncate">{clipLabel}</span>
                      <span className="block truncate">{clip.duration}s</span>
                      <button
                        type="button"
                        aria-label={`Trim start of clip ${clip.id}`}
                        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-[var(--color-pib-primary)]/40 opacity-0 focus:opacity-100 focus:outline-2 group-hover:opacity-100"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          setTrimDrag({ trackId: track.id, clipId: clip.id, edge: 'start', originClientX: event.clientX, deltaSeconds: 0 })
                        }}
                        onKeyDown={(event) => handleTrimKeyDown(event, track.id, clip.id, 'start')}
                      />
                      <button
                        type="button"
                        aria-label={`Trim end of clip ${clip.id}`}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-[var(--color-pib-primary)]/40 opacity-0 focus:opacity-100 focus:outline-2 group-hover:opacity-100"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          setTrimDrag({ trackId: track.id, clipId: clip.id, edge: 'end', originClientX: event.clientX, deltaSeconds: 0 })
                        }}
                        onKeyDown={(event) => handleTrimKeyDown(event, track.id, clip.id, 'end')}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
