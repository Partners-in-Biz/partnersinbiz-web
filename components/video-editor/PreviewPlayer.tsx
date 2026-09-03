'use client'

import { useEffect, useRef } from 'react'
import { clipTransformAt, clipVolumeAt } from '@/lib/video-editor/keyframes'
import { mediaKeyForRef } from '@/lib/video-editor/media-previews'
import { effectsToCssFilter } from '@/lib/video-editor/preview-filters'
import { sourceOffsetAt, speedAt } from '@/lib/video-editor/speed-ramps'
import type { EditorClip, EditorTimeline, EditorTrack, VideoEditorMediaPreview, VideoEditorProjectSettings } from '@/lib/video-editor/types'
import { Icon } from '@/components/studio'

export interface VisibleClip {
  track: EditorTrack
  clip: EditorClip
  /** Playhead in clip-relative seconds. */
  clipSeconds: number
}

/** Visual clips (video/overlay media + text anywhere) under the playhead, stacked top track last. */
export function visibleClipsAt(timeline: EditorTimeline, seconds: number): VisibleClip[] {
  const result: VisibleClip[] = []
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const within = seconds >= clip.timelineStart && seconds <= clip.timelineStart + clip.duration
      if (!within) continue
      const visualMedia = clip.media && clip.media.mediaKind !== 'audio' && (track.kind === 'video' || track.kind === 'overlay')
      const isText = Boolean(clip.text) && (track.kind === 'text' || track.kind === 'overlay')
      if (visualMedia || isText) result.push({ track, clip, clipSeconds: seconds - clip.timelineStart })
    }
  }
  return result
}

function SeekingVideo({ clip, clipSeconds, playing, src, volume, muted }: {
  clip: EditorClip
  clipSeconds: number
  playing: boolean
  src: string
  volume: number
  muted: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    const want = (clip.trimStart ?? 0) + sourceOffsetAt(clip, clipSeconds)
    if (Math.abs(video.currentTime - want) > 0.2) video.currentTime = want
    video.volume = Math.min(Math.max(volume, 0), 1)
    video.muted = muted || volume <= 0
    if (playing) {
      video.playbackRate = Math.min(Math.max(speedAt(clip, clipSeconds), 0.25), 4)
      void video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [clip, clipSeconds, playing, volume, muted])

  return <video ref={ref} data-testid={`preview-video-${clip.id}`} src={src} className="h-full w-full object-contain" playsInline preload="auto" />
}

export function PreviewPlayer({
  timeline,
  settings,
  mediaPreviews,
  playheadSeconds,
  playing,
  onPlayToggle,
  onSeek,
}: {
  timeline: EditorTimeline
  settings: VideoEditorProjectSettings
  mediaPreviews: Record<string, VideoEditorMediaPreview>
  playheadSeconds: number
  playing: boolean
  onPlayToggle: () => void
  onSeek: (seconds: number) => void
}) {
  const duration = Math.max(1, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clip.duration)))
  const visible = visibleClipsAt(timeline, playheadSeconds)

  return (
    <section className="pib-card-section space-y-3 p-4">
      <div className="relative overflow-hidden rounded-lg border border-[var(--color-pib-line)]" style={{ aspectRatio: `${settings.width}/${settings.height}`, background: settings.background || '#000' }}>
        {visible.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-white/50">Preview canvas</div>
        ) : null}
        {visible.map(({ track, clip, clipSeconds }) => {
          const transform = clipTransformAt(clip, clipSeconds)
          const filter = effectsToCssFilter(clip.effects)
          const style: React.CSSProperties = {
            transform: [
              `translate(-50%, -50%)`,
              `translate(${(transform.x / settings.width) * 100}%, ${(transform.y / settings.height) * 100}%)`,
              `scale(${transform.scale})`,
              `rotate(${transform.rotation}deg)`,
            ].join(' '),
            opacity: transform.opacity,
            filter: filter || undefined,
          }
          if (clip.media) {
            const key = mediaKeyForRef(clip.media)
            const src = mediaPreviews[key]?.proxy?.url ?? clip.media.url
            return (
              <div key={clip.id} className="absolute left-1/2 top-1/2 h-full w-full" style={style}>
                {clip.media.mediaKind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img data-testid={`preview-image-${clip.id}`} src={src} alt="" className="h-full w-full object-contain" />
                ) : (
                  <SeekingVideo clip={clip} clipSeconds={clipSeconds} playing={playing} src={src} volume={clipVolumeAt(clip, clipSeconds)} muted={Boolean(track.muted)} />
                )}
              </div>
            )
          }
          return (
            <div key={clip.id} className="absolute left-1/2 top-1/2" style={style}>
              <span
                className="block max-w-[80vw] whitespace-pre-wrap text-white"
                style={{ fontSize: `${(clip.text!.fontSizePx / settings.height) * 100}%`, color: clip.text!.color, textAlign: clip.text!.align, backgroundColor: clip.text!.backgroundColor }}
              >
                {clip.text!.content}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="pib-btn-primary text-sm" onClick={onPlayToggle} aria-label={playing ? 'Pause preview' : 'Play preview'}>
          <Icon name={playing ? 'pause' : 'play_arrow'} />
        </button>
        <input className="w-full" type="range" min={0} max={duration} step={0.1} value={playheadSeconds} onChange={(event) => onSeek(Number(event.target.value))}  aria-label="Value"/>
        <span className="w-16 text-right text-xs text-[var(--color-pib-text-muted)]">{playheadSeconds.toFixed(1)}s</span>
      </div>
    </section>
  )
}
