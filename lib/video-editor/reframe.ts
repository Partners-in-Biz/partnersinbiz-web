import type { EditorKeyframe, EditorTimeline, VideoEditorProjectSettings } from './types'

export const REFRAME_TARGET = { width: 1080, height: 1920, aspect: '9:16' as const }

export interface FocusSample {
  atSeconds: number
  x: number
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function reframeSettingsTo916(src: VideoEditorProjectSettings): VideoEditorProjectSettings {
  return { ...src, width: REFRAME_TARGET.width, height: REFRAME_TARGET.height, aspect: REFRAME_TARGET.aspect }
}

export function reframeTimelineTo916(
  timeline: EditorTimeline,
  src: VideoEditorProjectSettings,
  focusByFileId: Record<string, FocusSample[]>,
): EditorTimeline {
  const scaleFactor = REFRAME_TARGET.height / src.height
  return {
    version: 1,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!clip.media || clip.media.mediaKind === 'audio') return clip
        const baseScale = clip.transform?.scale ?? 1
        const scale = round3(baseScale * scaleFactor)
        const maxOffset = Math.max(0, (src.width * scale - REFRAME_TARGET.width) / 2)
        const focus = clip.media.type === 'upload' ? focusByFileId[clip.media.fileId] : undefined
        const focusKeyframes: EditorKeyframe[] | undefined = focus?.length
          ? focus.map((sample) => ({
              property: 'transform.x' as const,
              atSeconds: Math.max(0, sample.atSeconds),
              value: clamp(-((clamp(sample.x, 0, 1) - 0.5) * src.width * scale), -maxOffset, maxOffset),
              easing: 'ease_in_out' as const,
            }))
          : undefined
        const keyframes = [
          ...(clip.keyframes ?? [])
            .filter((keyframe) => keyframe.property !== 'transform.x')
            .map((keyframe) => keyframe.property === 'transform.scale'
              ? { ...keyframe, value: round3(keyframe.value * scaleFactor) }
              : keyframe),
          ...(focusKeyframes ?? []),
        ]
        return {
          ...clip,
          transform: {
            x: 0,
            y: clip.transform?.y ?? 0,
            scale,
            rotation: clip.transform?.rotation ?? 0,
            opacity: clip.transform?.opacity ?? 1,
          },
          keyframes: keyframes.length ? keyframes : undefined,
        }
      }),
    })),
  }
}
