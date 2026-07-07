import type { EditorClip, EditorClipTransform, EditorKeyframe, EditorKeyframeProperty } from './types'

/** cubic-bezier control points for the named ease presets (CSS-equivalent). */
export const EASE_BEZIER: Record<'linear' | 'ease_in' | 'ease_out' | 'ease_in_out', [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease_in: [0.42, 0, 1, 1],
  ease_out: [0, 0, 0.58, 1],
  ease_in_out: [0.42, 0, 0.58, 1],
}

function bezierAxis(p1: number, p2: number, u: number): number {
  const inv = 1 - u
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u
}

/**
 * Solve y for a given x on cubic-bezier((p1x,p1y),(p2x,p2y)) with endpoints
 * (0,0)→(1,1). Newton first, bisection fallback — matches CSS timing curves.
 */
export function cubicBezierProgress(p1x: number, p1y: number, p2x: number, p2y: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  let u = x
  for (let i = 0; i < 8; i += 1) {
    const currentX = bezierAxis(p1x, p2x, u) - x
    if (Math.abs(currentX) < 1e-7) return bezierAxis(p1y, p2y, u)
    const dx = 3 * (1 - u) * (1 - u) * p1x + 6 * (1 - u) * u * (p2x - p1x) + 3 * u * u * (1 - p2x)
    if (Math.abs(dx) < 1e-7) break
    u -= currentX / dx
    u = Math.min(Math.max(u, 0), 1)
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i += 1) {
    u = (lo + hi) / 2
    if (bezierAxis(p1x, p2x, u) < x) lo = u
    else hi = u
  }
  return bezierAxis(p1y, p2y, (lo + hi) / 2)
}

export function easeProgress(keyframe: EditorKeyframe, progress: number): number {
  const easing = keyframe.easing ?? 'linear'
  if (easing === 'linear') return progress
  if (easing === 'bezier') {
    const [p1x, p1y, p2x, p2y] = keyframe.bezier ?? EASE_BEZIER.linear
    return cubicBezierProgress(p1x, p1y, p2x, p2y, progress)
  }
  const [p1x, p1y, p2x, p2y] = EASE_BEZIER[easing]
  return cubicBezierProgress(p1x, p1y, p2x, p2y, progress)
}

export function keyframesForProperty(
  keyframes: EditorKeyframe[] | undefined,
  property: EditorKeyframeProperty,
): EditorKeyframe[] {
  return (keyframes ?? [])
    .filter((keyframe) => keyframe.property === property)
    .sort((a, b) => a.atSeconds - b.atSeconds)
}

export function interpolateKeyframes(
  keyframes: EditorKeyframe[] | undefined,
  property: EditorKeyframeProperty,
  atSeconds: number,
  fallback: number,
): number {
  const frames = keyframesForProperty(keyframes, property)
  if (!frames.length) return fallback
  if (atSeconds <= frames[0].atSeconds) return frames[0].value
  const last = frames[frames.length - 1]
  if (atSeconds >= last.atSeconds) return last.value
  for (let i = 0; i < frames.length - 1; i += 1) {
    const from = frames[i]
    const to = frames[i + 1]
    if (atSeconds >= from.atSeconds && atSeconds <= to.atSeconds) {
      const span = to.atSeconds - from.atSeconds
      if (span <= 0) return to.value
      const progress = easeProgress(from, (atSeconds - from.atSeconds) / span)
      return from.value + (to.value - from.value) * progress
    }
  }
  return last.value
}

const DEFAULT_TRANSFORM: EditorClipTransform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }

/** Effective transform at a clip-relative time: static transform + keyframe overrides. */
export function clipTransformAt(clip: EditorClip, clipSeconds: number): EditorClipTransform {
  const base = clip.transform ?? DEFAULT_TRANSFORM
  return {
    x: interpolateKeyframes(clip.keyframes, 'transform.x', clipSeconds, base.x),
    y: interpolateKeyframes(clip.keyframes, 'transform.y', clipSeconds, base.y),
    scale: interpolateKeyframes(clip.keyframes, 'transform.scale', clipSeconds, base.scale),
    rotation: interpolateKeyframes(clip.keyframes, 'transform.rotation', clipSeconds, base.rotation),
    opacity: interpolateKeyframes(clip.keyframes, 'transform.opacity', clipSeconds, base.opacity),
  }
}

export function clipVolumeAt(clip: EditorClip, clipSeconds: number): number {
  return interpolateKeyframes(clip.keyframes, 'volume', clipSeconds, clip.volume ?? 1)
}
