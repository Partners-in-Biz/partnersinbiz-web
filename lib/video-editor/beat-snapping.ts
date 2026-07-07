import { sourceOffsetAt } from './speed-ramps'
import type { EditorClip, EditorTimeline } from './types'

const EPSILON = 0.001

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function sourceBeatToTimelineSecond(clip: EditorClip, sourceBeatSeconds: number): number | null {
  if (!Number.isFinite(sourceBeatSeconds) || sourceBeatSeconds < 0) return null
  const trimStart = clip.trimStart ?? 0
  const targetOffset = sourceBeatSeconds - trimStart
  if (targetOffset < -EPSILON) return null
  const maxOffset = sourceOffsetAt(clip, clip.duration)
  if (targetOffset > maxOffset + EPSILON) return null
  let low = 0
  let high = clip.duration
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2
    if (sourceOffsetAt(clip, mid) < targetOffset) low = mid
    else high = mid
  }
  return round3(clip.timelineStart + high)
}

export function timelineBeatPositions(timeline: EditorTimeline, beatsByUpload: Record<string, number[]>): number[] {
  const positions: number[] = []
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.media?.type !== 'upload') continue
      const beats = beatsByUpload[clip.media.fileId] ?? []
      for (const beat of beats) {
        const position = sourceBeatToTimelineSecond(clip, beat)
        if (position !== null) positions.push(position)
      }
    }
  }
  return [...new Set(positions)].sort((a, b) => a - b)
}
