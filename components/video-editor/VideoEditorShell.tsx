'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { timelineBeatPositions } from '@/lib/video-editor/beat-snapping'
import type { LayoutPatch } from '@/lib/video-editor/layout-presets'
import { extractSelectionFragment, insertFragment } from '@/lib/video-editor/templates'
import {
  addClip, addTrack, clearClipGroup, moveClip, moveClipGroup, removeClip, removeClipGroup,
  rippleDeleteClip, rippleTrimClip, rollEdit, setClipGroup, slipClip, snapToBeats, splitClip, trimClip,
} from '@/lib/video-editor/timeline-ops'
import { defaultVideoEditorSettings } from '@/lib/video-editor/types'
import { mediaKeyForRef } from '@/lib/video-editor/media-previews'
import type { EditorClip, EditorTimeline, EditorTrack, EditorTrackKind, MediaRef, VideoEditorMediaPreview, VideoEditorProject, VideoEditorRenderJob } from '@/lib/video-editor/types'
import { AudioMixerPanel } from './AudioMixerPanel'
import { CaptionsPanel, type CaptionsPanelTranscriptOption } from './CaptionsPanel'
import { ExportDialog } from './ExportDialog'
import { InspectorPanel } from './InspectorPanel'
import { MediaLibraryPanel, type MediaLibrarySource } from './MediaLibraryPanel'
import { PreviewPlayer } from './PreviewPlayer'
import { TemplateBrowserPanel } from './TemplateBrowserPanel'
import { TimelinePanel, type TimelineEditMode, type TimelineSelection } from './TimelinePanel'
import { TtsPanel, type TtsGenerateRequest, type TtsVoiceOption } from './TtsPanel'
import { useTimelineHistory } from './useTimelineHistory'
import { GlassBar } from '@/components/ui/HudChip'

type RightPanelTab = 'inspector' | 'captions' | 'voiceover'
type BeatCacheEntry = { status: 'pending' | 'ready' | 'failed'; beats: number[]; checkedAt: number }
type SelectionEntry = { trackId: string; clipId: string }

const emptyTimeline: EditorTimeline = { version: 1, tracks: [] }
const DEFAULT_TEXT_CLIP_DURATION = 5

function makeClipId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function trackHasRoom(track: EditorTimeline['tracks'][number], start: number, duration: number): boolean {
  const end = start + duration
  return !track.clips.some((clip) => start < clip.timelineStart + clip.duration && end > clip.timelineStart)
}

function trackEnd(track: EditorTimeline['tracks'][number]): number {
  return Math.max(0, ...track.clips.map((clip) => clip.timelineStart + clip.duration))
}

function selectionKey(item: SelectionEntry): string {
  return `${item.trackId}:${item.clipId}`
}

function isLayoutClip(clip: EditorClip): boolean {
  return Boolean(clip.text || (clip.media && clip.media.mediaKind !== 'audio'))
}

function withoutTransformKeyframes(clip: EditorClip): EditorClip {
  if (!clip.keyframes?.length) return clip
  const keyframes = clip.keyframes.filter((keyframe) => !keyframe.property.startsWith('transform.'))
  return { ...clip, keyframes: keyframes.length ? keyframes : undefined }
}

export function VideoEditorShell({ projectId, orgId }: { projectId: string; orgId?: string }) {
  const [project, setProject] = useState<(VideoEditorProject & { id: string }) | null>(null)
  const [timeline, setTimeline] = useState<EditorTimeline>(emptyTimeline)
  const [selection, setSelection] = useState<TimelineSelection>([])
  const [editMode, setEditMode] = useState<TimelineEditMode>('select')
  const [snapBeats, setSnapBeats] = useState(false)
  const [beatsByUpload, setBeatsByUpload] = useState<Record<string, BeatCacheEntry>>({})
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pxPerSecond, setPxPerSecond] = useState(60)
  const [notice, setNotice] = useState('')
  const [sources, setSources] = useState<MediaLibrarySource[]>([])
  const [jobs, setJobs] = useState<Array<VideoEditorRenderJob & { id: string }>>([])
  const [busy, setBusy] = useState(false)
  const history = useTimelineHistory(timeline)
  const apiScope = useMemo(() => ({ orgId }), [orgId])
  const timelineRef = useRef(timeline)
  const playheadRef = useRef(playhead)

  const [mediaPreviews, setMediaPreviews] = useState<Record<string, VideoEditorMediaPreview>>({})

  const [rightTab, setRightTab] = useState<RightPanelTab>('inspector')
  const [transcripts, setTranscripts] = useState<CaptionsPanelTranscriptOption[]>([])
  const [voices, setVoices] = useState<TtsVoiceOption[]>([])
  const [captionsBusy, setCaptionsBusy] = useState(false)

  useEffect(() => {
    timelineRef.current = timeline
  }, [timeline])

  useEffect(() => {
    playheadRef.current = playhead
  }, [playhead])

  const timelineRefs = useMemo(() => {
    const refs: MediaRef[] = []
    const seen = new Set<string>()
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (!clip.media) continue
        const key = mediaKeyForRef(clip.media)
        if (seen.has(key)) continue
        seen.add(key)
        refs.push(clip.media)
      }
    }
    return refs
  }, [timeline])

  async function ensurePreviews(refs: MediaRef[]) {
    if (!orgId || !refs.length) return
    const res = await fetch(scopedApiPath('/api/v1/video-editor/media-previews', apiScope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, refs }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return
    const previews = (body.data?.previews ?? []) as Array<VideoEditorMediaPreview & { id: string }>
    setMediaPreviews((current) => {
      const next = { ...current }
      for (const preview of previews) next[preview.mediaKey] = preview
      return next
    })
  }

  // Ensure previews whenever the set of referenced media changes; poll while pending.
  useEffect(() => {
    void ensurePreviews(timelineRefs)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineRefs.map((ref) => mediaKeyForRef(ref)).join(','), orgId])

  useEffect(() => {
    const pending = Object.values(mediaPreviews).some((preview) => preview.status === 'pending' || preview.status === 'processing')
    if (!pending || !orgId) return
    const timer = window.setInterval(() => {
      const keys = Object.values(mediaPreviews)
        .filter((preview) => preview.status === 'pending' || preview.status === 'processing')
        .map((preview) => preview.mediaKey)
      void fetch(scopedApiPath(`/api/v1/video-editor/media-previews?orgId=${encodeURIComponent(orgId)}&keys=${encodeURIComponent(keys.join(','))}`, apiScope))
        .then((res) => res.json())
        .then((body) => {
          const previews = (body.data?.previews ?? []) as VideoEditorMediaPreview[]
          if (previews.length) {
            setMediaPreviews((current) => {
              const next = { ...current }
              for (const preview of previews) next[preview.mediaKey] = preview
              return next
            })
          }
        })
        .catch(() => {})
    }, 15000)
    return () => window.clearInterval(timer)
  }, [mediaPreviews, orgId, apiScope])

  const selectedClip = useMemo(() => {
    const first = selection[0]
    if (!first) return null
    const track = timeline.tracks.find((item) => item.id === first.trackId)
    return track?.clips.find((clip) => clip.id === first.clipId) ?? null
  }, [selection, timeline])

  const layoutSelection = useMemo(() => selection.filter((item) => {
    const track = timeline.tracks.find((entry) => entry.id === item.trackId)
    const clip = track?.clips.find((entry) => entry.id === item.clipId)
    return clip ? isLayoutClip(clip) : false
  }), [selection, timeline])

  const layoutDisabledReason = selection.length && layoutSelection.length !== selection.length
    ? 'Layout presets require selected visual clips.'
    : undefined

  useEffect(() => {
    if (!snapBeats || !orgId) return
    let cancelled = false

    function uploadIdsForTimeline() {
      const uploadIds = new Set<string>()
      for (const track of timeline.tracks) {
        for (const clip of track.clips) {
          if (clip.media?.type === 'upload') uploadIds.add(clip.media.fileId)
        }
      }
      return uploadIds
    }

    async function refreshBeatMarkers() {
      const now = Date.now()
      for (const uploadId of uploadIdsForTimeline()) {
        const cached = beatsByUpload[uploadId]
        if (cached?.status === 'ready') continue
        if (cached && now - cached.checkedAt < 4500) continue
        try {
          const res = await fetch(scopedApiPath(`/api/v1/video-editor/media/${uploadId}/beats`, apiScope))
          const body = await res.json().catch(() => ({}))
          if (!res.ok || cancelled) continue
          const status = typeof body.data?.status === 'string' ? body.data.status : 'none'
          const beats = Array.isArray(body.data?.beats)
            ? body.data.beats.filter((beat: unknown): beat is number => typeof beat === 'number' && Number.isFinite(beat))
            : []
          if (status === 'analyzed') {
            setBeatsByUpload((current) => ({ ...current, [uploadId]: { status: 'ready', beats, checkedAt: now } }))
          } else if (status === 'none') {
            setBeatsByUpload((current) => ({ ...current, [uploadId]: { status: 'pending', beats: [], checkedAt: now } }))
            const post = await fetch(scopedApiPath(`/api/v1/video-editor/media/${uploadId}/beats`, apiScope), { method: 'POST' })
            if (!post.ok && !cancelled) {
              setBeatsByUpload((current) => ({ ...current, [uploadId]: { status: 'failed', beats: [], checkedAt: Date.now() } }))
            }
          } else {
            setBeatsByUpload((current) => ({ ...current, [uploadId]: { status: status === 'failed' ? 'failed' : 'pending', beats: [], checkedAt: now } }))
          }
        } catch {
          if (!cancelled) setBeatsByUpload((current) => ({ ...current, [uploadId]: { status: 'failed', beats: [], checkedAt: Date.now() } }))
        }
      }
    }

    void refreshBeatMarkers()
    const timer = window.setInterval(() => void refreshBeatMarkers(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapBeats, timeline, orgId, beatsByUpload])

  async function loadProject() {
    const res = await fetch(scopedApiPath(`/api/v1/video-editor/projects/${projectId}`, apiScope))
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not load editor project')
      return
    }
    const next = body.data?.project as VideoEditorProject & { id: string }
    setProject(next)
    setTimeline(next.timeline)
    history.reset(next.timeline)
  }

  async function loadSources() {
    if (!orgId) return
    const res = await fetch(scopedApiPath('/api/v1/creative-canvas/sources', apiScope))
    const body = await res.json().catch(() => ({}))
    if (res.ok) setSources((body.data?.sources ?? body.sources ?? []) as MediaLibrarySource[])
  }

  async function loadJobs() {
    const res = await fetch(scopedApiPath(`/api/v1/video-editor/render-jobs?projectId=${encodeURIComponent(projectId)}`, apiScope))
    const body = await res.json().catch(() => ({}))
    if (res.ok) setJobs(body.data?.jobs ?? [])
  }

  useEffect(() => {
    void loadProject()
    void loadSources()
    void loadJobs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, orgId])

  const loadTranscripts = useCallback(async () => {
    const res = await fetch(scopedApiPath(`/api/v1/video-editor/transcripts?projectId=${encodeURIComponent(projectId)}`, apiScope))
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return
    const data = body.data ?? body
    setTranscripts(
      ((data.transcripts ?? []) as Array<{ id: string; status: string; source: string; language?: string }>).map((t) => ({
        id: t.id,
        status: t.status,
        language: t.language,
        label: t.source === 'tts' ? 'Voiceover transcript' : 'Audio transcript',
      })),
    )
  }, [projectId, apiScope])

  useEffect(() => {
    void loadTranscripts()
    void (async () => {
      const res = await fetch(scopedApiPath('/api/v1/video-editor/tts/voices', apiScope))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return
      setVoices(((body.data ?? body).voices ?? []) as TtsVoiceOption[])
    })()
  }, [loadTranscripts, apiScope])

  // Poll transcripts while any are still queued/running (mirrors media-preview polling).
  useEffect(() => {
    const pending = transcripts.some((t) => t.status === 'queued' || t.status === 'running')
    if (!pending) return
    const timer = window.setInterval(() => void loadTranscripts(), 10000)
    return () => window.clearInterval(timer)
  }, [transcripts, loadTranscripts])

  const handleTranscribe = useCallback(async () => {
    setCaptionsBusy(true)
    try {
      await fetch(scopedApiPath('/api/v1/video-editor/transcripts', apiScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      await loadTranscripts()
    } finally {
      setCaptionsBusy(false)
    }
  }, [projectId, apiScope, loadTranscripts])

  const handleGenerateCaptions = useCallback(
    async (transcriptId: string) => {
      setCaptionsBusy(true)
      try {
        const res = await fetch(scopedApiPath(`/api/v1/video-editor/projects/${projectId}/captions/generate`, apiScope), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcriptId }),
        })
        const body = await res.json().catch(() => ({}))
        const nextTimeline = (body.data ?? body).timeline as EditorTimeline | undefined
        if (nextTimeline) void persist(nextTimeline)
      } finally {
        setCaptionsBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, apiScope],
  )

  const handleTtsGenerate = useCallback(
    async (request: TtsGenerateRequest) => {
      await fetch(scopedApiPath(`/api/v1/video-editor/projects/${projectId}/tts`, apiScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      await Promise.all([loadProject(), loadTranscripts()])
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, apiScope, loadTranscripts],
  )

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setPlayhead((current) => current + 0.1), 100)
    return () => window.clearInterval(timer)
  }, [playing])

  async function persist(next: EditorTimeline) {
    if (!project) return
    setTimeline(next)
    history.commit(next)
    const res = await fetch(scopedApiPath(`/api/v1/video-editor/projects/${project.id}`, apiScope), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: project.title, timeline: next, settings: project.settings }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setNotice(body.error ?? 'Could not save timeline')
    }
  }

  function patchSelected(patch: Partial<EditorClip>) {
    if (!selection.length) return
    const next: EditorTimeline = {
      ...timeline,
      tracks: timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          selection.some((item) => item.trackId === track.id && item.clipId === clip.id) ? { ...clip, ...patch } : clip),
      })),
    }
    void persist(next)
  }

  function patchTrack(trackId: string, patch: Partial<EditorTrack>) {
    void persist({
      ...timeline,
      tracks: timeline.tracks.map((track) => (track.id === trackId ? { ...track, ...patch } : track)),
    })
  }

  function applyLayoutPatches(patches: LayoutPatch[]) {
    if (!patches.length) return
    const targets = layoutSelection.slice(0, patches.length)
    const targetTransforms = new Map(targets.map((target, index) => [selectionKey(target), patches[index]?.transform]))
    void persist({
      ...timeline,
      tracks: timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          const transform = targetTransforms.get(selectionKey({ trackId: track.id, clipId: clip.id }))
          if (!transform) return clip
          return { ...withoutTransformKeyframes(clip), transform }
        }),
      })),
    })
  }

  function runOp(op: () => EditorTimeline, failure: string) {
    try { void persist(op()) } catch (error) { setNotice(error instanceof Error ? error.message : failure) }
  }

  function handleTrimClip(trackId: string, clipId: string, edge: 'start' | 'end', deltaSeconds: number) {
    if (editMode === 'ripple') runOp(() => rippleTrimClip(timeline, trackId, clipId, { edge, deltaSeconds }), 'Could not ripple trim')
    else runOp(() => trimClip(timeline, trackId, clipId, { edge, deltaSeconds }), 'Could not trim clip')
  }

  function handleRemoveSelected() {
    const first = selection[0]
    if (!first) return
    const track = timeline.tracks.find((item) => item.id === first.trackId)
    const clip = track?.clips.find((item) => item.id === first.clipId)
    if (!clip) return
    if (editMode === 'ripple') runOp(() => rippleDeleteClip(timeline, first.trackId, first.clipId), 'Could not ripple delete')
    else if (clip.groupId) runOp(() => removeClipGroup(timeline, clip.groupId!), 'Could not delete linked clips')
    else runOp(() => removeClip(timeline, first.trackId, first.clipId), 'Could not remove clip')
    setSelection([])
  }

  function handleMoveClip(trackId: string, clipId: string, toStart: number) {
    const track = timeline.tracks.find((item) => item.id === trackId)
    const clip = track?.clips.find((item) => item.id === clipId)
    const readyBeats = Object.fromEntries(
      Object.entries(beatsByUpload)
        .filter(([, entry]) => entry.status === 'ready')
        .map(([uploadId, entry]) => [uploadId, entry.beats]),
    )
    const allBeats = snapBeats ? timelineBeatPositions(timeline, readyBeats) : []
    const snapped = allBeats.length ? snapToBeats(toStart, allBeats) : toStart
    if (clip?.groupId) runOp(() => moveClipGroup(timeline, clip.groupId!, snapped - clip.timelineStart), 'Could not move linked clips')
    else runOp(() => moveClip(timeline, trackId, clipId, { toStart: snapped }), 'Could not move clip')
  }

  function handleLinkSelection() {
    if (selection.length < 2) return
    runOp(() => setClipGroup(timeline, selection.map((item) => ({ trackId: item.trackId, clipId: item.clipId }))), 'Could not link clips')
  }

  function handleUnlinkSelection() {
    const grouped = selection
      .map((item) => timeline.tracks.find((t) => t.id === item.trackId)?.clips.find((c) => c.id === item.clipId)?.groupId)
      .find(Boolean)
    if (grouped) runOp(() => clearClipGroup(timeline, grouped), 'Could not unlink clips')
  }

  function addMediaClip(clip: EditorClip) {
    const targetKind: EditorTrackKind = clip.media?.mediaKind === 'audio' ? 'audio' : 'video'
    let working = timeline
    let targetTrack = working.tracks.find((track) => track.kind === targetKind && !track.locked)
    if (!targetTrack) {
      working = addTrack(working, { kind: targetKind, label: targetKind === 'audio' ? 'Audio' : 'Video' })
      targetTrack = working.tracks.find((track) => track.kind === targetKind && !timeline.tracks.some((existing) => existing.id === track.id))
    }
    if (!targetTrack) {
      setNotice(`Could not find or create a ${targetKind} track.`)
      return
    }
    try {
      const next = addClip(working, targetTrack.id, { ...clip, timelineStart: playhead })
      void persist(next)
      setSelection([{ trackId: targetTrack.id, clipId: clip.id }])
      setNotice('Clip added to the timeline.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add clip')
    }
  }

  function addTextClip() {
    let working = timeline
    let timelineStart = playhead
    let targetTrack = working.tracks.find((track) =>
      track.kind === 'text' && !track.locked && trackHasRoom(track, timelineStart, DEFAULT_TEXT_CLIP_DURATION))

    if (!targetTrack) {
      const reusableTextTrack = working.tracks.find((track) => track.kind === 'text' && !track.locked)
      if (reusableTextTrack) {
        targetTrack = reusableTextTrack
        timelineStart = Math.max(playhead, trackEnd(reusableTextTrack))
      } else {
        working = addTrack(working, { kind: 'text', label: 'Text', index: 0 })
        targetTrack = working.tracks.find((track) => track.kind === 'text' && !timeline.tracks.some((existing) => existing.id === track.id))
      }
    }

    if (!targetTrack) {
      setNotice('Could not find or create a text track.')
      return
    }

    const clip: EditorClip = {
      id: makeClipId('title'),
      timelineStart,
      duration: DEFAULT_TEXT_CLIP_DURATION,
      text: {
        content: 'Title text',
        fontSizePx: 72,
        color: '#ffffff',
        align: 'center',
        animationPreset: 'none',
      },
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    }

    try {
      const next = addClip(working, targetTrack.id, clip)
      void persist(next)
      setSelection([{ trackId: targetTrack.id, clipId: clip.id }])
      setPlayhead(timelineStart)
      setNotice('Text title added. Edit the copy in the Inspector.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add text')
    }
  }

  function addUploadedSource(source: MediaLibrarySource) {
    setSources((current) => [
      source,
      ...current.filter((item) => item.id !== source.id),
    ])
  }

  async function insertTemplateFragment(fragment: EditorTimeline) {
    try {
      await persist(insertFragment(timelineRef.current, fragment, playheadRef.current))
      setNotice('Template inserted at the playhead.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not insert template')
      throw error
    }
  }

  async function saveSelectionAsTemplate() {
    if (!orgId) {
      setNotice('Choose an organisation before saving templates.')
      return
    }
    const first = selection[0]
    if (!first) {
      setNotice('Select clips before saving a template.')
      return
    }
    const fragment = extractSelectionFragment(timeline, selection)
    if (!fragment.tracks.some((track) => track.clips.length)) {
      setNotice('Select clips before saving a template.')
      return
    }
    const title = window.prompt('Template name?')
    if (!title?.trim()) {
      setNotice('Template save cancelled.')
      return
    }
    const res = await fetch(scopedApiPath('/api/v1/video-editor/templates', apiScope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        title: title.trim(),
        category: 'lower_third',
        fragment,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = body.error ?? 'Could not save template'
      setNotice(message)
      throw new Error(message)
    }
    setNotice(fragment.tracks.length > 1 ? 'Multi-track template saved.' : 'Template saved.')
  }

  async function renderProject() {
    setBusy(true)
    setNotice('')
    try {
      const res = await fetch(scopedApiPath(`/api/v1/video-editor/projects/${projectId}/render`, apiScope), { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not dispatch render')
      setNotice('Render dispatched. Status will update here.')
      await loadJobs()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not dispatch render')
    } finally {
      setBusy(false)
    }
  }

  if (!project) {
    return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><div className="pib-skeleton h-96" />{notice ? <p className="mt-4 text-sm text-[var(--color-pib-text-muted)]">{notice}</p> : null}</main>
  }

  const settings = project.settings ?? defaultVideoEditorSettings()
  return (
    <main className="mx-auto max-w-[1600px] space-y-3 p-4 sm:p-6 lg:p-8" data-module-accent="cyan">
      <GlassBar className="flex-wrap items-end justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="sc-tiny !text-[10px]">Video Editor</p>
          <h1 className="pib-page-title !text-lg">{project.title}</h1>
          <p className="mt-0.5 max-w-3xl text-xs text-[var(--color-pib-text-muted)]">Assemble source media, trim clips, add text, render an MP4, and send the result back to YouTube Studio or Marketing Studio.</p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" className="btn-pib-ghost btn-pib-sm font-label" disabled={!history.canUndo} onClick={() => setTimeline(history.undo())}>Undo</button>
          <button type="button" className="btn-pib-ghost btn-pib-sm font-label" disabled={!history.canRedo} onClick={() => setTimeline(history.redo())}>Redo</button>
          <button type="button" className={snapBeats ? 'btn-pib-primary btn-pib-sm font-label' : 'btn-pib-ghost btn-pib-sm font-label'} onClick={() => setSnapBeats((value) => !value)}>Snap to beat</button>
        </div>
      </GlassBar>
      {notice ? <div className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm text-[var(--color-pib-text-muted)]">{notice}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[320px_1fr_320px]">
        <div className="space-y-4">
          <MediaLibraryPanel
            orgId={orgId}
            projectId={project.id}
            canvasId={project.canvasId}
            sources={sources}
            mediaPreviews={mediaPreviews}
            onRefresh={loadSources}
            onAddClip={addMediaClip}
            onSourceUploaded={addUploadedSource}
          />
          <TemplateBrowserPanel
            orgId={orgId}
            channelWorkspaceId={project.channelWorkspaceId}
            canSaveSelection={selection.length > 0}
            onInsert={insertTemplateFragment}
            onSaveSelection={saveSelectionAsTemplate}
          />
        </div>
        <div className="space-y-4">
          <PreviewPlayer timeline={timeline} settings={settings} mediaPreviews={mediaPreviews} playheadSeconds={playhead} playing={playing} onPlayToggle={() => setPlaying((value) => !value)} onSeek={setPlayhead} />
          <TimelinePanel
            timeline={timeline}
            selection={selection}
            playheadSeconds={playhead}
            pxPerSecond={pxPerSecond}
            editMode={editMode}
            mediaPreviews={mediaPreviews}
            onEditModeChange={setEditMode}
            onSelectionChange={(next) => setSelection(Array.isArray(next) ? next : [])}
            onSeek={setPlayhead}
            onZoomChange={setPxPerSecond}
            onMoveClip={handleMoveClip}
            onTrimClip={handleTrimClip}
            onRollEdit={(trackId, leftId, rightId, delta) => runOp(() => rollEdit(timeline, trackId, leftId, rightId, delta), 'Could not roll edit')}
            onSlipClip={(trackId, clipId, delta) => runOp(() => slipClip(timeline, trackId, clipId, delta), 'Could not slip clip')}
            onSplitAtPlayhead={() => {
              const first = selection[0]
              if (!first) return
              runOp(() => splitClip(timeline, first.trackId, first.clipId, playhead), 'Could not split clip')
            }}
            onRemoveSelected={handleRemoveSelected}
            onLinkSelection={handleLinkSelection}
            onUnlinkSelection={handleUnlinkSelection}
            onToggleTrackFlag={(trackId, flag) => {
              void persist({ ...timeline, tracks: timeline.tracks.map((track) => track.id === trackId ? { ...track, [flag]: !track[flag] } : track) })
            }}
            onAddTrack={(kind: EditorTrackKind) => void persist(addTrack(timeline, { kind, label: kind }))}
            onAddTextClip={addTextClip}
          />
          <AudioMixerPanel timeline={timeline} onPatchTrack={patchTrack} />
        </div>
        <div className="space-y-4">
          <div role="tablist" aria-label="Right panel" className="flex gap-1 rounded-lg border border-[var(--color-pib-line)] p-1">
            {(['inspector', 'captions', 'voiceover'] as RightPanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={rightTab === tab}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm capitalize ${rightTab === tab ? 'bg-[var(--color-pib-line)]  text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]'}`}
                onClick={() => setRightTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          {rightTab === 'inspector' ? (
            <InspectorPanel
              clip={selectedClip}
              orgId={orgId}
              playheadSeconds={playhead}
              settings={settings}
              selectedClipIds={layoutSelection.map((item) => item.clipId)}
              layoutDisabledReason={layoutDisabledReason}
              onPatch={patchSelected}
              onApplyLayout={applyLayoutPatches}
              onTrim={(edge, deltaSeconds) => {
                const first = selection[0]
                if (!first) return
                handleTrimClip(first.trackId, first.clipId, edge, deltaSeconds)
              }}
            />
          ) : null}
          {rightTab === 'captions' ? (
            <CaptionsPanel
              timeline={timeline}
              transcripts={transcripts}
              busy={captionsBusy}
              onApplyTimeline={(next) => void persist(next)}
              onTranscribe={() => void handleTranscribe()}
              onGenerateCaptions={(transcriptId) => void handleGenerateCaptions(transcriptId)}
              onSeek={setPlayhead}
            />
          ) : null}
          {rightTab === 'voiceover' ? (
            <TtsPanel voices={voices} busy={captionsBusy} onGenerate={handleTtsGenerate} />
          ) : null}
          <ExportDialog projectId={project.id} timeline={timeline} settings={settings} latestJob={jobs[0]} busy={busy} onRender={() => void renderProject()} />
        </div>
      </div>
    </main>
  )
}
