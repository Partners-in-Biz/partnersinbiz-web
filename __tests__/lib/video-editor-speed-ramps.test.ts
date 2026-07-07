import {
  SPEED_RAMP_PRESETS,
  hasSpeedRamp,
  rampSegments,
  sourceOffsetAt,
  speedAt,
} from '@/lib/video-editor/speed-ramps'
import { SPEED_RAMP_PRESET_IDS } from '@/lib/video-editor/types'
import type { EditorClip } from '@/lib/video-editor/types'

const rampClip = (extra: Partial<EditorClip> = {}): EditorClip => ({
  id: 'c',
  timelineStart: 0,
  duration: 4,
  media: { type: 'upload', fileId: 'f', url: 'https://x.test/a.mp4', mediaKind: 'video' },
  keyframes: [
    { property: 'speed', atSeconds: 0, value: 1 },
    { property: 'speed', atSeconds: 4, value: 2 },
  ],
  ...extra,
})

describe('speedAt / hasSpeedRamp', () => {
  it('falls back to clip.speed then 1 without speed keyframes', () => {
    expect(hasSpeedRamp({ id: 'p', timelineStart: 0, duration: 2 })).toBe(false)
    expect(speedAt({ id: 'p', timelineStart: 0, duration: 2, speed: 1.5 }, 1)).toBe(1.5)
    expect(speedAt({ id: 'p', timelineStart: 0, duration: 2 }, 1)).toBe(1)
    expect(hasSpeedRamp(rampClip())).toBe(true)
    expect(speedAt(rampClip(), 2)).toBeCloseTo(1.5, 5)
  })
})

describe('sourceOffsetAt', () => {
  it('integrates the ramp: linear 1→2 over 4s consumes 6s of source', () => {
    expect(sourceOffsetAt(rampClip(), 0)).toBeCloseTo(0, 5)
    expect(sourceOffsetAt(rampClip(), 4)).toBeCloseTo(6, 3)
    expect(sourceOffsetAt(rampClip(), 2)).toBeCloseTo(2.5, 3) // ∫0..2 (1+t/4) dt
  })

  it('is just speed × time for constant-speed clips', () => {
    expect(sourceOffsetAt({ id: 'p', timelineStart: 0, duration: 4, speed: 2 }, 3)).toBe(6)
  })
})

describe('rampSegments', () => {
  it('returns one segment for constant speed', () => {
    expect(rampSegments({ id: 'p', timelineStart: 0, duration: 4, speed: 2 })).toEqual([
      { outputStart: 0, outputDuration: 4, sourceStart: 0, sourceDuration: 8, speed: 2 },
    ])
  })

  it('subdivides ramped intervals with midpoint speeds that integrate exactly for linear ramps', () => {
    const segments = rampSegments(rampClip(), 4)
    expect(segments).toHaveLength(4)
    expect(segments.map((s) => s.speed)).toEqual([1.125, 1.375, 1.625, 1.875])
    expect(segments.reduce((sum, s) => sum + s.outputDuration, 0)).toBeCloseTo(4, 5)
    expect(segments.reduce((sum, s) => sum + s.sourceDuration, 0)).toBeCloseTo(6, 3)
    // sourceStart is cumulative
    expect(segments[1].sourceStart).toBeCloseTo(segments[0].sourceDuration, 5)
  })
})

describe('SPEED_RAMP_PRESETS', () => {
  it('builds sorted, clamped speed keyframes for every preset id', () => {
    for (const id of SPEED_RAMP_PRESET_IDS) {
      const frames = SPEED_RAMP_PRESETS[id].build(10)
      expect(frames.length).toBeGreaterThanOrEqual(2)
      expect(frames.every((f) => f.property === 'speed' && f.value >= 0.25 && f.value <= 4)).toBe(true)
      expect(frames[0].atSeconds).toBe(0)
      expect(frames[frames.length - 1].atSeconds).toBe(10)
      const times = frames.map((f) => f.atSeconds)
      expect([...times].sort((a, b) => a - b)).toEqual(times)
    }
    expect(SPEED_RAMP_PRESETS.hero_time.build(10).some((f) => f.value < 1)).toBe(true) // slow-mo core
    expect(SPEED_RAMP_PRESETS.flash_in.build(10)[0].value).toBeGreaterThan(1)
  })
})
