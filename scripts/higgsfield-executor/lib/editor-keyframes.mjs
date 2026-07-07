// Executor-side mirror of lib/video-editor/keyframes.ts + speed-ramps.ts.
// Kept in exact numeric lockstep by __tests__/lib/video-editor-keyframe-parity.test.ts —
// if you change one side, change the other and re-run the parity test.
import { fmt } from './editor-filtergraph.mjs'

export const EASE_BEZIER = {
  linear: [0, 0, 1, 1],
  ease_in: [0.42, 0, 1, 1],
  ease_out: [0, 0, 0.58, 1],
  ease_in_out: [0.42, 0, 0.58, 1],
}

function bezierAxis(p1, p2, u) {
  const inv = 1 - u
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u
}

export function cubicBezierProgress(p1x, p1y, p2x, p2y, x) {
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

export function easeProgress(keyframe, progress) {
  const easing = keyframe.easing ?? 'linear'
  if (easing === 'linear') return progress
  const points = easing === 'bezier' ? (keyframe.bezier ?? EASE_BEZIER.linear) : EASE_BEZIER[easing]
  if (!points) return progress
  return cubicBezierProgress(points[0], points[1], points[2], points[3], progress)
}

export function keyframesForProperty(keyframes, property) {
  return (keyframes ?? [])
    .filter((keyframe) => keyframe.property === property)
    .sort((a, b) => a.atSeconds - b.atSeconds)
}

export function interpolateKeyframes(keyframes, property, atSeconds, fallback) {
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

const round3 = (value) => Math.round(value * 1000) / 1000

export function hasSpeedRamp(clip) {
  return keyframesForProperty(clip.keyframes, 'speed').length > 0
}

export function speedAt(clip, clipSeconds) {
  const fallback = clip.speed && clip.speed > 0 ? clip.speed : 1
  const value = interpolateKeyframes(clip.keyframes, 'speed', clipSeconds, fallback)
  return Math.min(Math.max(value, 0.25), 4)
}

export function rampSegments(clip, subdivisions = 4) {
  const duration = clip.duration
  if (!hasSpeedRamp(clip)) {
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
    return [{ outputStart: 0, outputDuration: duration, sourceStart: 0, sourceDuration: round3(duration * speed), speed }]
  }
  const frames = keyframesForProperty(clip.keyframes, 'speed')
  const boundaries = [0, ...frames.map((frame) => frame.atSeconds).filter((t) => t > 0 && t < duration), duration]
    .filter((t, index, all) => index === 0 || t - all[index - 1] > 0.0005)
  const segments = []
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

export function sourceOffsetAt(clip, clipSeconds) {
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

// ---------------------------------------------------------------------------
// ffmpeg expression builders
// ---------------------------------------------------------------------------

const EASED_SUBSEGMENTS = 8

/** Pre-sample keyframes into piecewise-linear breakpoints (eased/bezier → 8 slices). */
export function keyframeBreakpoints(keyframes) {
  const frames = [...keyframes].sort((a, b) => a.atSeconds - b.atSeconds)
  const points = []
  for (let i = 0; i < frames.length; i += 1) {
    const from = frames[i]
    points.push({ t: from.atSeconds, v: from.value })
    const to = frames[i + 1]
    if (!to) break
    const easing = from.easing ?? 'linear'
    if (easing === 'linear') continue
    const span = to.atSeconds - from.atSeconds
    if (span <= 0) continue
    for (let s = 1; s < EASED_SUBSEGMENTS; s += 1) {
      const progress = s / EASED_SUBSEGMENTS
      points.push({
        t: from.atSeconds + span * progress,
        v: from.value + (to.value - from.value) * easeProgress(from, progress),
      })
    }
  }
  return points
}

/**
 * Piecewise-linear ffmpeg expression over `timeExpr` (e.g. 't' or '(t-3)').
 * Constant before the first and after the last breakpoint.
 */
export function keyframeExpr(keyframes, fallback, timeExpr = 't') {
  if (!keyframes?.length) return fmt(fallback)
  const points = keyframeBreakpoints(keyframes)
  if (points.length === 1) return fmt(points[0].v)
  let expr = fmt(points[points.length - 1].v)
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const from = points[i]
    const to = points[i + 1]
    const span = to.t - from.t
    const lerp = span > 0
      ? `${fmt(from.v)}+(${fmt(to.v)}-${fmt(from.v)})*(${timeExpr}-${fmt(from.t)})/${fmt(span)}`
      : fmt(to.v)
    expr = `if(lt(${timeExpr},${fmt(to.t)}),${lerp},${expr})`
  }
  return `if(lt(${timeExpr},${fmt(points[0].t)}),${fmt(points[0].v)},${expr})`
}

/**
 * sendcmd command script driving `colorchannelmixer@{label} aa` — sampled because
 * colorchannelmixer takes commands, not per-frame expressions.
 */
export function sendcmdOpacityCommands(keyframes, fallback, label, durationSeconds, stepSeconds = 0.1) {
  const commands = []
  let previous = null
  for (let t = 0; t <= durationSeconds + 1e-9; t = round3(t + stepSeconds)) {
    const value = round3(Math.min(Math.max(interpolateKeyframes(keyframes, 'transform.opacity', t, fallback), 0), 1))
    if (previous !== null && value === previous) continue
    commands.push(`${fmt(t)} colorchannelmixer@${label} aa ${fmt(value)}`)
    previous = value
  }
  return commands.join(';')
}
