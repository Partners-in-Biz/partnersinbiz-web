'use client'

import { useEffect, useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { addClip, addTrack, removeClip, splitClip } from '@/lib/video-editor/timeline-ops'
import { defaultVideoEditorSettings } from '@/lib/video-editor/types'
import type { EditorClip, EditorTimeline, EditorTrackKind, VideoEditorProject, VideoEditorRenderJob } from '@/lib/video-editor/types'
import { ExportDialog } from './ExportDialog'
import { InspectorPanel } from './InspectorPanel'
import { MediaLibraryPanel } from './MediaLibraryPanel'
import { PreviewPlayer } from './PreviewPlayer'
import { TimelinePanel, type TimelineSelection } from './TimelinePanel'
import { useTimelineHistory } from './useTimelineHistory'

const emptyTimeline: EditorTimeline = { version: 1, tracks: [] }

export function VideoEditorShell({ projectId, orgId }: { projectId: string; orgId?: string }) {
  const [project, setProject] = useState<(VideoEditorProject & { id: string }) | null>(null)
  const [timeline, setTimeline] = useState<EditorTimeline>(emptyTimeline)
  const [selection, setSelection] = useState<TimelineSelection | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pxPerSecond, setPxPerSecond] = useState(60)
  const [notice, setNotice] = useState('')
  const [sources, setSources] = useState([])
  const [jobs, setJobs] = useState<Array<VideoEditorRenderJob & { id: string }>>([])
  const [busy, setBusy] = useState(false)
  const history = useTimelineHistory(timeline)
  const apiScope = useMemo(() => ({ orgId }), [orgId])

  const selectedClip = useMemo(() => {
    if (!selection) return null
    const track = timeline.tracks.find((item) => item.id === selection.trackId)
    return track?.clips.find((clip) => selection.clipIds.includes(clip.id)) ?? null
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
    if (res.ok) setSources(body.data?.sources ?? body.sources ?? [])
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
    if (!selection) return
    const next: EditorTimeline = {
      ...timeline,
      tracks: timeline.tracks.map((track) => track.id === selection.trackId
        ? { ...track, clips: track.clips.map((clip) => selection.clipIds.includes(clip.id) ? { ...clip, ...patch } : clip) }
        : track),
    }
    void persist(next)
  }

  function addMediaClip(clip: EditorClip) {
    const targetTrack = timeline.tracks.find((track) => track.kind === (clip.media?.mediaKind === 'audio' ? 'audio' : 'video')) ?? timeline.tracks[0]
    if (!targetTrack) return
    try {
      const next = addClip(timeline, targetTrack.id, { ...clip, timelineStart: playhead })
      void persist(next)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add clip')
    }
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
        <MediaLibraryPanel orgId={orgId} sources={sources} onRefresh={loadSources} onAddClip={addMediaClip} />
        <div className="space-y-4">
          <PreviewPlayer timeline={timeline} settings={settings} playheadSeconds={playhead} playing={playing} onPlayToggle={() => setPlaying((value) => !value)} onSeek={setPlayhead} />
          <TimelinePanel
            timeline={timeline}
            selection={selection}
            playheadSeconds={playhead}
            pxPerSecond={pxPerSecond}
            onSelectionChange={setSelection}
            onSeek={setPlayhead}
            onZoomChange={setPxPerSecond}
            onMoveClip={() => undefined}
            onTrimClip={() => undefined}
            onSplitAtPlayhead={() => {
              if (!selection?.clipIds[0]) return
              try { void persist(splitClip(timeline, selection.trackId, selection.clipIds[0], playhead)) } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not split clip') }
            }}
            onRemoveSelected={() => {
              if (!selection?.clipIds[0]) return
              try { void persist(removeClip(timeline, selection.trackId, selection.clipIds[0])); setSelection(null) } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not remove clip') }
            }}
            onToggleTrackFlag={(trackId, flag) => {
              void persist({ ...timeline, tracks: timeline.tracks.map((track) => track.id === trackId ? { ...track, [flag]: !track[flag] } : track) })
            }}
            onAddTrack={(kind: EditorTrackKind) => void persist(addTrack(timeline, { kind, label: kind }))}
          />
        </div>
        <div className="space-y-4">
          <InspectorPanel clip={selectedClip} onPatch={patchSelected} />
          <ExportDialog projectId={project.id} timeline={timeline} settings={settings} latestJob={jobs[0]} busy={busy} onRender={() => void renderProject()} />
        </div>
      </div>
    </main>
  )
}
