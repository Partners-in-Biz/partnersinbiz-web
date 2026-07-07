import { interpolateKeyframes, keyframesForProperty } from './keyframes'
import type { EditorClip, EditorKeyframe, SpeedRampPresetId } from './types'

export interface RampSegment {
  /** Clip-relative output start (seconds). */
  outputStart: number
  outputDuration: number
  /** Source offset relative to the clip's trimStart. */
  sourceStart: number
  sourceDuration: number
  speed: number
}

export function hasSpeedRamp(clip: EditorClip): boolean {
  return keyframesForProperty(clip.keyframes, 'speed').length > 0
}

export function speedAt(clip: EditorClip, clipSeconds: number): number {
  const fallback = clip.speed && clip.speed > 0 ? clip.speed : 1
  const value = interpolateKeyframes(clip.keyframes, 'speed', clipSeconds, fallback)
  return Math.min(Math.max(value, 0.25), 4)
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000

export function rampSegments(clip: EditorClip, subdivisions = 4): RampSegment[] {
  const duration = clip.duration
  if (!hasSpeedRamp(clip)) {
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
    return [{ outputStart: 0, outputDuration: duration, sourceStart: 0, sourceDuration: round3(duration * speed), speed }]
  }
  const frames = keyframesForProperty(clip.keyframes, 'speed')
  const boundaries = [0, ...frames.map((frame) => frame.atSeconds).filter((t) => t > 0 && t < duration), duration]
    .filter((t, index, all) => index === 0 || t - all[index - 1] > 0.0005)
  const segments: RampSegment[] = []
  let sourceCursor = 0
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const from = boundaries[i]
    const to = boundaries[i + 1]
    const flat = Math.abs(speedAt(clip, from) - speedAt(clip, to)) < 0.0005
    const slices = flat ? 1 : Math.max(1, subdivisions)
    const sliceDuration = (to - from) / slices
    for (let s = 0; s < slices; s += 1) {
      const outputStart = from + s * sliceDuration
      const speed = speedAt(clip, outputStart + sliceDuration / 2)
      const sourceDuration = sliceDuration * speed
      segments.push({
        outputStart: round3(outputStart),
        outputDuration: round3(sliceDuration),
        sourceStart: round3(sourceCursor),
        sourceDuration: round3(sourceDuration),
        speed: round3(speed),
      })
      sourceCursor += sourceDuration
    }
  }
  return segments
}

/** Source seconds consumed after `clipSeconds` of output — ∫ speed dt via the same segmentation. */
export function sourceOffsetAt(clip: EditorClip, clipSeconds: number): number {
  if (!hasSpeedRamp(clip)) {
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
    return clipSeconds * speed
  }
  const target = Math.min(Math.max(clipSeconds, 0), clip.duration)
  let total = 0
  for (const segment of rampSegments(clip, 16)) {
    if (segment.outputStart >= target) break
    const covered = Math.min(segment.outputDuration, target - segment.outputStart)
    total += covered * segment.speed
  }
  return total
}

export const SPEED_RAMP_PRESETS: Record<SpeedRampPresetId, {
  label: string
  description: string
  build: (durationSeconds: number) => EditorKeyframe[]
}> = {
  montage: {
    label: 'Montage',
    description: 'Speeds up through the middle, settles back for the ending.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 1, easing: 'ease_in_out' },
      { property: 'speed', atSeconds: round3(d * 0.5), value: 2.5, easing: 'ease_in_out' },
      { property: 'speed', atSeconds: d, value: 1 },
    ],
  },
  hero_time: {
    label: 'Hero Time',
    description: 'Dramatic slow-motion core with normal-speed bookends.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 1, easing: 'ease_out' },
      { property: 'speed', atSeconds: round3(d * 0.35), value: 0.3, easing: 'linear' },
      { property: 'speed', atSeconds: round3(d * 0.65), value: 0.3, easing: 'ease_in' },
      { property: 'speed', atSeconds: d, value: 1 },
    ],
  },
  flash_in: {
    label: 'Flash In',
    description: 'Blazes in fast, relaxes to real time.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 3, easing: 'ease_out' },
      { property: 'speed', atSeconds: round3(d * 0.3), value: 1, easing: 'linear' },
      { property: 'speed', atSeconds: d, value: 1 },
    ],
  },
  flash_out: {
    label: 'Flash Out',
    description: 'Real time, then accelerates out of the shot.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 1, easing: 'linear' },
      { property: 'speed', atSeconds: round3(d * 0.7), value: 1, easing: 'ease_in' },
      { property: 'speed', atSeconds: d, value: 3 },
    ],
  },
  bullet: {
    label: 'Bullet',
    description: 'Snaps into a near-freeze at the midpoint, then snaps out.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 1, easing: 'linear' },
      { property: 'speed', atSeconds: round3(d * 0.4), value: 1, easing: 'ease_out' },
      { property: 'speed', atSeconds: round3(d * 0.45), value: 0.25, easing: 'linear' },
      { property: 'speed', atSeconds: round3(d * 0.55), value: 0.25, easing: 'ease_in' },
      { property: 'speed', atSeconds: round3(d * 0.6), value: 1, easing: 'linear' },
      { property: 'speed', atSeconds: d, value: 1 },
    ],
  },
}
