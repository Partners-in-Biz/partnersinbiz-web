'use client'

import { useEffect, useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import {
  addClip, addTrack, clearClipGroup, moveClip, moveClipGroup, removeClip, removeClipGroup,
  rippleDeleteClip, rippleTrimClip, rollEdit, setClipGroup, slipClip, splitClip, trimClip,
} from '@/lib/video-editor/timeline-ops'
import { defaultVideoEditorSettings } from '@/lib/video-editor/types'
import type { EditorClip, EditorTimeline, EditorTrackKind, VideoEditorMediaPreview, VideoEditorProject, VideoEditorRenderJob } from '@/lib/video-editor/types'
import { ExportDialog } from './ExportDialog'
import { InspectorPanel } from './InspectorPanel'
import { MediaLibraryPanel, type MediaLibrarySource } from './MediaLibraryPanel'
import { PreviewPlayer } from './PreviewPlayer'
import { TimelinePanel, type TimelineEditMode, type TimelineSelection } from './TimelinePanel'
import { useTimelineHistory } from './useTimelineHistory'

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

export function VideoEditorShell({ projectId, orgId }: { projectId: string; orgId?: string }) {
  const [project, setProject] = useState<(VideoEditorProject & { id: string }) | null>(null)
  const [timeline, setTimeline] = useState<EditorTimeline>(emptyTimeline)
  const [selection, setSelection] = useState<TimelineSelection>([])
  const [editMode, setEditMode] = useState<TimelineEditMode>('select')
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pxPerSecond, setPxPerSecond] = useState(60)
  const [notice, setNotice] = useState('')
  const [sources, setSources] = useState<MediaLibrarySource[]>([])
  const [jobs, setJobs] = useState<Array<VideoEditorRenderJob & { id: string }>>([])
  const [busy, setBusy] = useState(false)
  const history = useTimelineHistory(timeline)
  const apiScope = useMemo(() => ({ orgId }), [orgId])

  const mediaPreviews = useMemo<Record<string, VideoEditorMediaPreview>>(() => ({}), [])

  const selectedClip = useMemo(() => {
    const first = selection[0]
    if (!first) return null
    const track = timeline.tracks.find((item) => item.id === first.trackId)
    return track?.clips.find((clip) => clip.id === first.clipId) ?? null
  }, [selection, timeline])

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
    if (clip?.groupId) runOp(() => moveClipGroup(timeline, clip.groupId!, toStart - clip.timelineStart), 'Could not move linked clips')
    else runOp(() => moveClip(timeline, trackId, clipId, { toStart }), 'Could not move clip')
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
    return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><div className="pib-skeleton h-96" />{notice ? <p className="mt-4 text-sm text-on-surface-variant">{notice}</p> : null}</main>
  }

  const settings = project.settings ?? defaultVideoEditorSettings()
  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Video Editor</p>
          <h1 className="font-headline text-3xl font-bold text-on-surface">{project.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">Assemble source media, trim clips, add text, render an MP4, and send the result back to YouTube Studio or Marketing Studio.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="pib-btn-ghost text-sm" disabled={!history.canUndo} onClick={() => setTimeline(history.undo())}>Undo</button>
          <button type="button" className="pib-btn-ghost text-sm" disabled={!history.canRedo} onClick={() => setTimeline(history.redo())}>Redo</button>
        </div>
      </div>
      {notice ? <div className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm text-on-surface-variant">{notice}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[320px_1fr_320px]">
        <MediaLibraryPanel orgId={orgId} sources={sources} onRefresh={loadSources} onAddClip={addMediaClip} onSourceUploaded={addUploadedSource} />
        <div className="space-y-4">
          <PreviewPlayer timeline={timeline} settings={settings} playheadSeconds={playhead} playing={playing} onPlayToggle={() => setPlaying((value) => !value)} onSeek={setPlayhead} />
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
        </div>
        <div className="space-y-4">
          <InspectorPanel
            clip={selectedClip}
            playheadSeconds={playhead}
            onPatch={patchSelected}
            onTrim={(edge, deltaSeconds) => {
              const first = selection[0]
              if (!first) return
              handleTrimClip(first.trackId, first.clipId, edge, deltaSeconds)
            }}
          />
          <ExportDialog projectId={project.id} timeline={timeline} settings={settings} latestJob={jobs[0]} busy={busy} onRender={() => void renderProject()} />
        </div>
      </div>
    </main>
  )
}
