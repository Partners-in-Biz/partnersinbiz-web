'use client'

import type { EditorTimeline, VideoEditorProjectSettings } from '@/lib/video-editor/types'

export function PreviewPlayer({
  timeline,
  settings,
  playheadSeconds,
  playing,
  onPlayToggle,
  onSeek,
}: {
  timeline: EditorTimeline
  settings: VideoEditorProjectSettings
  playheadSeconds: number
  playing: boolean
  onPlayToggle: () => void
  onSeek: (seconds: number) => void
}) {
  const activeText = timeline.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.text && playheadSeconds >= clip.timelineStart && playheadSeconds <= clip.timelineStart + clip.duration)?.text?.content
  const duration = Math.max(1, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clip.duration)))

  return (
    <section className="pib-card-section space-y-3 p-4">
      <div className="relative overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-black" style={{ aspectRatio: `${settings.width}/${settings.height}` }}>
        <div className="absolute inset-0 grid place-items-center text-center text-sm text-white/70">
          {activeText ? <span className="max-w-[80%] text-3xl font-bold text-white">{activeText}</span> : 'Preview canvas'}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="pib-btn-primary text-sm" onClick={onPlayToggle} aria-label={playing ? 'Pause preview' : 'Play preview'}>
          <span className="material-symbols-rounded text-base">{playing ? 'pause' : 'play_arrow'}</span>
        </button>
        <input className="w-full" type="range" min={0} max={duration} step={0.1} value={playheadSeconds} onChange={(event) => onSeek(Number(event.target.value))} />
        <span className="w-16 text-right text-xs text-on-surface-variant">{playheadSeconds.toFixed(1)}s</span>
      </div>
    </section>
  )
}
