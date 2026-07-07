import {
  EASE_BEZIER,
  clipTransformAt,
  clipVolumeAt,
  cubicBezierProgress,
  interpolateKeyframes,
  keyframesForProperty,
} from '@/lib/video-editor/keyframes'
import type { EditorClip, EditorKeyframe } from '@/lib/video-editor/types'

const kf = (atSeconds: number, value: number, extra: Partial<EditorKeyframe> = {}): EditorKeyframe =>
  ({ property: 'transform.opacity', atSeconds, value, ...extra })

describe('cubicBezierProgress', () => {
  it('hits the endpoints exactly and clamps x', () => {
    expect(cubicBezierProgress(0.42, 0, 1, 1, 0)).toBe(0)
    expect(cubicBezierProgress(0.42, 0, 1, 1, 1)).toBe(1)
    expect(cubicBezierProgress(0.42, 0, 1, 1, -0.5)).toBe(0)
    expect(cubicBezierProgress(0.42, 0, 1, 1, 1.5)).toBe(1)
  })

  it('is linear for the identity curve and slow-starting for ease_in', () => {
    expect(cubicBezierProgress(0, 0, 1, 1, 0.25)).toBeCloseTo(0.25, 5)
    expect(cubicBezierProgress(...EASE_BEZIER.ease_in, 0.25)).toBeLessThan(0.25)
    expect(cubicBezierProgress(...EASE_BEZIER.ease_out, 0.25)).toBeGreaterThan(0.25)
  })
})

describe('interpolateKeyframes', () => {
  const frames = [kf(1, 10), kf(3, 30, { easing: 'linear' })]

  it('returns fallback with no keyframes and clamps outside the range', () => {
    expect(interpolateKeyframes(undefined, 'transform.opacity', 2, 0.7)).toBe(0.7)
    expect(interpolateKeyframes(frames, 'transform.opacity', 0, 99)).toBe(10)
    expect(interpolateKeyframes(frames, 'transform.opacity', 9, 99)).toBe(30)
  })

  it('interpolates linearly and honors easing + custom bezier', () => {
    expect(interpolateKeyframes(frames, 'transform.opacity', 2, 0)).toBeCloseTo(20, 5)
    const eased = [kf(0, 0, { easing: 'ease_in' }), kf(2, 100)]
    expect(interpolateKeyframes(eased, 'transform.opacity', 1, 0)).toBeLessThan(50)
    const bez = [kf(0, 0, { easing: 'bezier', bezier: [0, 0, 1, 1] }), kf(2, 100)]
    expect(interpolateKeyframes(bez, 'transform.opacity', 1, 0)).toBeCloseTo(50, 5)
  })

  it('only reads keyframes for the requested property, sorted', () => {
    const mixed = [kf(2, 5), { property: 'volume', atSeconds: 2, value: 0 } as EditorKeyframe, kf(0, 1)]
    expect(keyframesForProperty(mixed, 'transform.opacity').map((k) => k.atSeconds)).toEqual([0, 2])
    expect(interpolateKeyframes(mixed, 'volume', 2, 1)).toBe(0)
  })
})

describe('clip helpers', () => {
  const clip: EditorClip = {
    id: 'c',
    timelineStart: 5,
    duration: 4,
    volume: 0.8,
    transform: { x: 100, y: 0, scale: 1, rotation: 0, opacity: 1 },
    keyframes: [
      { property: 'transform.x', atSeconds: 0, value: 0 },
      { property: 'transform.x', atSeconds: 4, value: 200 },
      { property: 'volume', atSeconds: 0, value: 0 },
      { property: 'volume', atSeconds: 2, value: 0.8 },
    ],
  }

  it('merges keyframed values over the static transform', () => {
    expect(clipTransformAt(clip, 2)).toEqual({ x: 100, y: 0, scale: 1, rotation: 0, opacity: 1 })
    // transform.x keyframes override the static x
    expect(clipTransformAt(clip, 2).x).toBe(100) // (0 -> 200 at t=2) = 100
    expect(clipTransformAt(clip, 0).x).toBe(0)
  })

  it('interpolates volume with clip.volume fallback', () => {
    expect(clipVolumeAt(clip, 1)).toBeCloseTo(0.4, 5)
    expect(clipVolumeAt({ id: 'p', timelineStart: 0, duration: 1 }, 0.5)).toBe(1)
    expect(clipVolumeAt({ id: 'p', timelineStart: 0, duration: 1, volume: 0.3 }, 0.5)).toBe(0.3)
  })
})
