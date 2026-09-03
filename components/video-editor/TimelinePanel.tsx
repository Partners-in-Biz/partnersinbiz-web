'use client'

import { Icon } from '@/components/studio'

import { useEffect, useRef, useState } from 'react'
import type { EditorClip, EditorTimeline, EditorTrackKind, VideoEditorMediaPreview } from '@/lib/video-editor/types'
import { mediaKeyForRef } from '@/lib/video-editor/media-previews'
import { WaveformStrip } from './WaveformStrip'

export type TimelineSelection = Array<{ trackId: string; clipId: string }>
export type TimelineEditMode = 'select' | 'ripple' | 'roll' | 'slip'

/**
 * Legacy selection shape kept for backward compatibility with Phase 0 callers /
 * tests. The panel normalises both shapes internally into a flat array.
 */
export interface LegacyTimelineSelection {
  trackId: string
  clipIds: string[]
}

type SelectionProp = TimelineSelection | LegacyTimelineSelection | null

const TRIM_COMMIT_THRESHOLD_SECONDS = 0.05
const TRIM_KEY_STEP_SECONDS = 0.1
const TRIM_KEY_STEP_LARGE_SECONDS = 1

interface TimelinePanelProps {
  timeline: EditorTimeline
  selection: SelectionProp
  playheadSeconds: number
  pxPerSecond: number
  editMode?: TimelineEditMode
  mediaPreviews?: Record<string, VideoEditorMediaPreview>
  onEditModeChange?: (mode: TimelineEditMode) => void
  /**
   * Emits the new flat-array selection to array-shaped callers, and the legacy
   * `{ trackId, clipIds }` shape (or null) to Phase 0 callers. The shape emitted
   * mirrors the shape of the incoming `selection` prop.
   */
  onSelectionChange: (selection: TimelineSelection | LegacyTimelineSelection | null) => void
  onSeek: (seconds: number) => void
  onZoomChange: (pxPerSecond: number) => void
  onMoveClip: (trackId: string, clipId: string, toStart: number) => void
  onTrimClip: (trackId: string, clipId: string, edge: 'start' | 'end', deltaSeconds: number) => void
  onRollEdit?: (trackId: string, leftClipId: string, rightClipId: string, deltaSeconds: number) => void
  onSlipClip?: (trackId: string, clipId: string, deltaSeconds: number) => void
  onSplitAtPlayhead: () => void
  onRemoveSelected: () => void
  onLinkSelection?: () => void
  onUnlinkSelection?: () => void
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

/** Pixel drag → signed seconds. Positive start-handle drags trim source away. */
export function trimDeltaFromDrag(edge: 'start' | 'end', dxPx: number, pxPerSecond: number): number {
  return Math.round((dxPx / pxPerSecond) * 1000) / 1000
}

/** Accept both the flat array selection and the legacy single-track shape. */
function normalizeSelection(selection: SelectionProp): TimelineSelection {
  if (!selection) return []
  if (Array.isArray(selection)) return selection
  return selection.clipIds.map((clipId) => ({ trackId: selection.trackId, clipId }))
}

const EDIT_MODES: Array<{ id: TimelineEditMode; label: string; icon: string }> = [
  { id: 'select', label: 'Select mode', icon: 'arrow_selector_tool' },
  { id: 'ripple', label: 'Ripple mode', icon: 'keyboard_double_arrow_left' },
  { id: 'roll', label: 'Roll mode', icon: 'swap_horiz' },
  { id: 'slip', label: 'Slip mode', icon: 'open_with' },
]

interface DragState {
  kind: 'trim' | 'slip'
  trackId: string
  clipId: string
  edge?: 'start' | 'end'
  originClientX: number
  deltaSeconds: number
}

export function TimelinePanel(props: TimelinePanelProps) {
  const {
    timeline, selection, playheadSeconds, pxPerSecond, editMode = 'select', mediaPreviews = {},
    onEditModeChange, onSelectionChange, onSeek, onZoomChange, onMoveClip, onTrimClip,
    onRollEdit, onSlipClip, onSplitAtPlayhead, onRemoveSelected, onLinkSelection,
    onUnlinkSelection, onToggleTrackFlag, onAddTrack, onAddTextClip,
  } = props

  const normalizedSelection = normalizeSelection(selection)
  // Phase 0 callers pass the legacy `{ trackId, clipIds }` object (or null) and
  // expect that shape back; the new Shell passes a flat array.
  const legacyMode = !Array.isArray(selection)
  const [drag, setDrag] = useState<DragState | null>(null)

  function emitSelection(next: TimelineSelection) {
    if (legacyMode) {
      const trackId = next[0]?.trackId ?? ''
      onSelectionChange(next.length ? { trackId, clipIds: next.filter((item) => item.trackId === trackId).map((item) => item.clipId) } : null)
      return
    }
    onSelectionChange(next)
  }
  // Guards against double-commit when a pointerup both hits a handle element and
  // bubbles to the window-level listener for the same drag.
  const committedRef = useRef(false)

  const duration = Math.max(30, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clip.duration)))
  const rulerTicks = Array.from({ length: Math.ceil(duration / 5) + 1 }, (_, index) => index * 5)
  const snapCandidates = timeline.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.timelineStart, clip.timelineStart + clip.duration]))
  const isSelected = (trackId: string, clipId: string) => normalizedSelection.some((item) => item.trackId === trackId && item.clipId === clipId)
  const selectedGrouped = normalizedSelection.some((item) => {
    const track = timeline.tracks.find((t) => t.id === item.trackId)
    return Boolean(track?.clips.find((c) => c.id === item.clipId)?.groupId)
  })

  function leftNeighbor(trackId: string, clip: EditorClip): EditorClip | null {
    const track = timeline.tracks.find((t) => t.id === trackId)
    if (!track) return null
    return track.clips.find((item) => Math.abs(item.timelineStart + item.duration - clip.timelineStart) < 0.0005) ?? null
  }

  function commitDrag(state: DragState, clientX: number) {
    if (committedRef.current) return
    committedRef.current = true
    const dx = clientX - state.originClientX
    const delta = trimDeltaFromDrag(state.edge ?? 'end', dx, pxPerSecond)
    if (Math.abs(delta) < TRIM_COMMIT_THRESHOLD_SECONDS) return
    const track = timeline.tracks.find((t) => t.id === state.trackId)
    const clip = track?.clips.find((c) => c.id === state.clipId)
    if (!clip) return
    if (state.kind === 'slip') {
      onSlipClip?.(state.trackId, state.clipId, delta)
      return
    }
    if (editMode === 'roll' && state.edge === 'start') {
      const neighbor = leftNeighbor(state.trackId, clip)
      if (neighbor) onRollEdit?.(state.trackId, neighbor.id, state.clipId, delta)
      return
    }
    onTrimClip(state.trackId, state.clipId, state.edge ?? 'end', delta)
  }

  // Window-level drag support (Phase 0 behavior: pointermove/up dispatched on window).
  useEffect(() => {
    if (!drag) return
    const handleMove = (event: PointerEvent) => {
      setDrag((current) => current
        ? { ...current, deltaSeconds: (event.clientX - current.originClientX) / pxPerSecond }
        : current)
    }
    const handleUp = (event: PointerEvent) => {
      const state = drag
      setDrag(null)
      commitDrag(state, event.clientX)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, pxPerSecond, editMode, onTrimClip, onRollEdit, onSlipClip])

  function handleTrimKeyDown(event: React.KeyboardEvent, trackId: string, clipId: string, edge: 'start' | 'end') {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? TRIM_KEY_STEP_LARGE_SECONDS : TRIM_KEY_STEP_SECONDS
    onTrimClip(trackId, clipId, edge, event.key === 'ArrowLeft' ? -step : step)
  }

  function handleClipClick(event: React.MouseEvent, trackId: string, clipId: string) {
    event.stopPropagation()
    if (event.shiftKey) {
      if (isSelected(trackId, clipId)) emitSelection(normalizedSelection.filter((item) => item.clipId !== clipId || item.trackId !== trackId))
      else emitSelection([...normalizedSelection, { trackId, clipId }])
      return
    }
    emitSelection([{ trackId, clipId }])
  }

  return (
    <section className="pib-card-section overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-pib-line)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[var(--color-pib-line)]">
            {EDIT_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-label={mode.label}
                aria-pressed={editMode === mode.id}
                className={['px-2 py-1 text-sm', editMode === mode.id ? 'bg-[var(--sc-ink-soft)]/20 text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]'].join(' ')}
                onClick={() => onEditModeChange?.(mode.id)}
              >
                <Icon name={mode.icon} />
              </button>
            ))}
          </div>
          <button type="button" className="pib-btn-ghost text-sm" onClick={onSplitAtPlayhead} aria-label="Split at playhead">
            <Icon name="content_cut" />
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={onRemoveSelected} aria-label="Delete selected">
            <Icon name="delete" />
          </button>
          <button type="button" className="pib-btn-ghost text-sm" disabled={normalizedSelection.length < 2} onClick={onLinkSelection} aria-label="Link clips">
            <Icon name="link" />
          </button>
          <button type="button" className="pib-btn-ghost text-sm" disabled={!selectedGrouped} onClick={onUnlinkSelection} aria-label="Unlink clips">
            <Icon name="link_off" />
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={() => onZoomChange(Math.min(180, Math.round(pxPerSecond * 1.25)))} aria-label="Zoom in">
            <Icon name="zoom_in" />
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={() => onZoomChange(Math.max(20, Math.round(pxPerSecond / 1.25)))} aria-label="Zoom out">
            <Icon name="zoom_out" />
          </button>
        </div>
        <label className="text-sm text-[var(--color-pib-text-muted)]">
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
           aria-label="Input">
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
          <div className="flex border-b border-[var(--color-pib-line)] text-xs text-[var(--color-pib-text-muted)]">
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
                <span key={tick} style={{ left: `${tick * pxPerSecond}px` }} className="absolute top-2">{tick}s</span>
              ))}
              <span style={{ left: `${playheadSeconds * pxPerSecond}px` }} className="absolute inset-y-0 w-px bg-[var(--sc-ink-soft)]" />
            </div>
          </div>
          {timeline.tracks.map((track) => (
            <div key={track.id} className="flex border-b border-[var(--color-pib-line)]">
              <div className="w-48 shrink-0 space-y-2 p-2">
                <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{track.label || track.kind}</p>
                <div className="flex gap-1">
                  <button type="button" className="rounded border border-[var(--color-pib-line)] px-2 py-1 text-xs" onClick={() => onToggleTrackFlag(track.id, 'muted')} aria-label={`Mute ${track.label || track.kind}`}>M</button>
                  <button type="button" className="rounded border border-[var(--color-pib-line)] px-2 py-1 text-xs" onClick={() => onToggleTrackFlag(track.id, 'locked')} aria-label={`Lock ${track.label || track.kind}`}>L</button>
                </div>
              </div>
              <div className="relative h-20 flex-1">
                {track.clips.map((clip) => {
                  const selected = isSelected(track.id, clip.id)
                  const isDraggingThisClip = drag?.trackId === track.id && drag.clipId === clip.id
                  const startPreview = isDraggingThisClip && drag.kind === 'trim' && drag.edge === 'start' ? drag.deltaSeconds : 0
                  const endPreview = isDraggingThisClip && drag.kind === 'trim' && drag.edge === 'end' ? drag.deltaSeconds : 0
                  const left = (clip.timelineStart + startPreview) * pxPerSecond
                  const width = Math.max(8, (clip.duration - startPreview + endPreview) * pxPerSecond)
                  const clipLabel = clip.text?.content || clip.media?.mediaKind || clip.id
                  const previewKey = clip.media ? mediaKeyForRef(clip.media) : ''
                  const preview = previewKey ? mediaPreviews[previewKey] : undefined
                  const filmstrip = preview?.filmstrip
                  return (
                    <div
                      key={clip.id}
                      data-testid={`timeline-clip-${clip.id}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Clip ${clipLabel}`}
                      style={{
                        left: `${left}px`,
                        width: `${width}px`,
                        ...(filmstrip ? {
                          backgroundImage: `url(${filmstrip.url})`,
                          backgroundSize: `auto 100%`,
                          backgroundRepeat: 'repeat-x',
                        } : {}),
                      }}
                      className={[
                        'group absolute top-3 h-12 overflow-hidden rounded-md border px-2 text-left text-xs',
                        selected ? 'border-[var(--sc-ink-soft)] bg-[var(--sc-ink-soft)]/20 text-[var(--color-pib-text)]' : 'border-[var(--color-pib-line)] bg-white/[0.04] text-[var(--color-pib-text-muted)]',
                        editMode === 'slip' ? 'cursor-ew-resize' : 'cursor-pointer',
                      ].join(' ')}
                      onClick={(event) => handleClipClick(event, track.id, clip.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          emitSelection([{ trackId: track.id, clipId: clip.id }])
                        }
                      }}
                      onDoubleClick={() => onMoveClip(track.id, clip.id, snapSeconds(clip.timelineStart + 1, snapCandidates))}
                      onPointerDown={(event) => {
                        if (editMode !== 'slip' || !clip.media) return
                        committedRef.current = false
                        setDrag({ kind: 'slip', trackId: track.id, clipId: clip.id, originClientX: event.clientX, deltaSeconds: 0 })
                        ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        if (drag?.kind === 'slip' && drag.clipId === clip.id) {
                          setDrag((current) => current ? { ...current, deltaSeconds: (event.clientX - current.originClientX) / pxPerSecond } : current)
                        }
                      }}
                      onPointerUp={(event) => {
                        if (drag?.kind === 'slip' && drag.clipId === clip.id) {
                          const state = drag
                          setDrag(null)
                          commitDrag(state, event.clientX)
                        }
                      }}
                    >
                      {preview?.waveform && track.kind === 'audio' ? (
                        <WaveformStrip waveformUrl={preview.waveform.url} className="pointer-events-none absolute inset-0 opacity-60" />
                      ) : null}
                      <span className="pointer-events-none relative block truncate">{clipLabel}</span>
                      <span className="pointer-events-none relative block truncate">{clip.duration}s</span>
                      {clip.groupId ? (
                        <span data-testid={`group-badge-${clip.id}`} className="absolute right-1 top-1 rounded bg-[var(--sc-ink-soft)]/40 px-1 text-[10px]" title={`Linked group ${clip.groupId}`}>
                          <Icon name="link" />
                        </span>
                      ) : null}
                      {(clip.keyframes ?? []).map((keyframe, index) => (
                        <span
                          key={`${keyframe.property}-${index}`}
                          data-testid={`keyframe-marker-${clip.id}-${index}`}
                          title={`${keyframe.property} @ ${keyframe.atSeconds}s`}
                          style={{ left: `${keyframe.atSeconds * pxPerSecond}px` }}
                          className="absolute bottom-0.5 h-1.5 w-1.5 rotate-45 bg-[var(--sc-surface)]"
                        />
                      ))}
                      {(
                        <>
                          <button
                            type="button"
                            data-testid={`trim-handle-start-${clip.id}`}
                            aria-label={`Trim start of clip ${clip.id}`}
                            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-[var(--sc-ink-soft)]/40 opacity-0 focus:opacity-100 focus:outline-2 group-hover:opacity-100"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => {
                              event.stopPropagation()
                              event.preventDefault()
                              committedRef.current = false
                              setDrag({ kind: 'trim', trackId: track.id, clipId: clip.id, edge: 'start', originClientX: event.clientX, deltaSeconds: 0 })
                              ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
                            }}
                            onPointerMove={(event) => {
                              if (drag?.kind === 'trim' && drag.clipId === clip.id) {
                                setDrag((current) => current ? { ...current, deltaSeconds: (event.clientX - current.originClientX) / pxPerSecond } : current)
                              }
                            }}
                            onPointerUp={(event) => {
                              event.stopPropagation()
                              if (drag?.kind === 'trim' && drag.clipId === clip.id && drag.edge === 'start') {
                                const state = drag
                                setDrag(null)
                                commitDrag(state, event.clientX)
                              }
                            }}
                            onKeyDown={(event) => handleTrimKeyDown(event, track.id, clip.id, 'start')}
                          />
                          <button
                            type="button"
                            data-testid={`trim-handle-end-${clip.id}`}
                            aria-label={`Trim end of clip ${clip.id}`}
                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-[var(--sc-ink-soft)]/40 opacity-0 focus:opacity-100 focus:outline-2 group-hover:opacity-100"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => {
                              event.stopPropagation()
                              event.preventDefault()
                              committedRef.current = false
                              setDrag({ kind: 'trim', trackId: track.id, clipId: clip.id, edge: 'end', originClientX: event.clientX, deltaSeconds: 0 })
                              ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
                            }}
                            onPointerMove={(event) => {
                              if (drag?.kind === 'trim' && drag.clipId === clip.id) {
                                setDrag((current) => current ? { ...current, deltaSeconds: (event.clientX - current.originClientX) / pxPerSecond } : current)
                              }
                            }}
                            onPointerUp={(event) => {
                              event.stopPropagation()
                              if (drag?.kind === 'trim' && drag.clipId === clip.id && drag.edge === 'end') {
                                const state = drag
                                setDrag(null)
                                commitDrag(state, event.clientX)
                              }
                            }}
                            onKeyDown={(event) => handleTrimKeyDown(event, track.id, clip.id, 'end')}
                          />
                        </>
                      )}
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
