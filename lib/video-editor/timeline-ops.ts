import type { EditorClip, EditorTimeline, EditorTrack, EditorTrackKind } from './types'

export class TimelineOpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimelineOpError'
  }
}

const EPSILON = 0.0005

function cloneTimeline(timeline: EditorTimeline): EditorTimeline {
  return JSON.parse(JSON.stringify(timeline)) as EditorTimeline
}

function findTrack(timeline: EditorTimeline, trackId: string): EditorTrack {
  const track = timeline.tracks.find((item) => item.id === trackId)
  if (!track) throw new TimelineOpError(`Track '${trackId}' not found.`)
  return track
}

function findClip(track: EditorTrack, clipId: string): EditorClip {
  const clip = track.clips.find((item) => item.id === clipId)
  if (!clip) throw new TimelineOpError(`Clip '${clipId}' not found on track '${track.id}'.`)
  return clip
}

function sortClips(track: EditorTrack) {
  track.clips.sort((a, b) => a.timelineStart - b.timelineStart)
}

function assertNoOverlap(track: EditorTrack) {
  sortClips(track)
  let previousEnd = -Infinity
  let previousId = ''
  for (const clip of track.clips) {
    if (clip.timelineStart < previousEnd - EPSILON) {
      throw new TimelineOpError(`Clips '${previousId}' and '${clip.id}' overlap on track '${track.id}'.`)
    }
    previousEnd = clip.timelineStart + clip.duration
    previousId = clip.id
  }
}

function uniqueTrackId(timeline: EditorTimeline, kind: EditorTrackKind): string {
  let index = timeline.tracks.length + 1
  let id = `track-${kind}-${index}`
  const existing = new Set(timeline.tracks.map((track) => track.id))
  while (existing.has(id)) {
    index += 1
    id = `track-${kind}-${index}`
  }
  return id
}

export function addTrack(
  timeline: EditorTimeline,
  options: { kind: EditorTrackKind; label?: string; index?: number },
): EditorTimeline {
  const next = cloneTimeline(timeline)
  const track: EditorTrack = {
    id: uniqueTrackId(next, options.kind),
    kind: options.kind,
    ...(options.label ? { label: options.label } : {}),
    clips: [],
  }
  const index = options.index === undefined
    ? next.tracks.length
    : Math.min(Math.max(options.index, 0), next.tracks.length)
  next.tracks.splice(index, 0, track)
  return next
}

export function removeTrack(timeline: EditorTimeline, trackId: string): EditorTimeline {
  const next = cloneTimeline(timeline)
  findTrack(next, trackId)
  next.tracks = next.tracks.filter((track) => track.id !== trackId)
  return next
}

export function reorderTracks(timeline: EditorTimeline, trackId: string, toIndex: number): EditorTimeline {
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  next.tracks = next.tracks.filter((item) => item.id !== trackId)
  const index = Math.min(Math.max(toIndex, 0), next.tracks.length)
  next.tracks.splice(index, 0, track)
  return next
}

export function addClip(timeline: EditorTimeline, trackId: string, clip: EditorClip): EditorTimeline {
  if (!(clip.duration > 0)) throw new TimelineOpError('Clip duration must be greater than zero.')
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  if (track.clips.some((item) => item.id === clip.id)) {
    throw new TimelineOpError(`Clip id '${clip.id}' already exists on track '${trackId}'.`)
  }
  track.clips.push({ ...clip, timelineStart: Math.max(0, clip.timelineStart) })
  assertNoOverlap(track)
  return next
}

export function removeClip(timeline: EditorTimeline, trackId: string, clipId: string): EditorTimeline {
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  findClip(track, clipId)
  track.clips = track.clips.filter((clip) => clip.id !== clipId)
  return next
}

export function moveClip(
  timeline: EditorTimeline,
  trackId: string,
  clipId: string,
  options: { toStart: number; targetTrackId?: string },
): EditorTimeline {
  const next = cloneTimeline(timeline)
  const sourceTrack = findTrack(next, trackId)
  const clip = findClip(sourceTrack, clipId)
  const targetTrack = options.targetTrackId ? findTrack(next, options.targetTrackId) : sourceTrack
  if (targetTrack.id !== sourceTrack.id && targetTrack.kind !== sourceTrack.kind) {
    throw new TimelineOpError(`Cannot move a ${sourceTrack.kind} clip onto a ${targetTrack.kind} track.`)
  }
  sourceTrack.clips = sourceTrack.clips.filter((item) => item.id !== clipId)
  clip.timelineStart = Math.max(0, options.toStart)
  targetTrack.clips.push(clip)
  assertNoOverlap(targetTrack)
  return next
}

export function trimClip(
  timeline: EditorTimeline,
  trackId: string,
  clipId: string,
  options: { edge: 'start' | 'end'; deltaSeconds: number },
): EditorTimeline {
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  const clip = findClip(track, clipId)
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1

  if (options.edge === 'end') {
    const duration = clip.duration + options.deltaSeconds
    if (!(duration > EPSILON)) throw new TimelineOpError('Trim would remove the whole clip.')
    clip.duration = round3(duration)
  } else {
    const start = clip.timelineStart + options.deltaSeconds
    const duration = clip.duration - options.deltaSeconds
    const trimStart = (clip.trimStart ?? 0) + options.deltaSeconds * speed
    if (!(duration > EPSILON)) throw new TimelineOpError('Trim would remove the whole clip.')
    if (start < -EPSILON) throw new TimelineOpError('Trim would push the clip before the timeline start.')
    if (trimStart < -EPSILON) throw new TimelineOpError('Trim would rewind before the source start.')
    clip.timelineStart = round3(Math.max(0, start))
    clip.duration = round3(duration)
    clip.trimStart = round3(Math.max(0, trimStart))
  }
  assertNoOverlap(track)
  return next
}

export function splitClip(
  timeline: EditorTimeline,
  trackId: string,
  clipId: string,
  atTimelineSeconds: number,
): EditorTimeline {
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  const clip = findClip(track, clipId)
  const clipEnd = clip.timelineStart + clip.duration
  if (atTimelineSeconds <= clip.timelineStart + EPSILON || atTimelineSeconds >= clipEnd - EPSILON) {
    throw new TimelineOpError('Split point must fall inside the clip.')
  }
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
  const leftDuration = round3(atTimelineSeconds - clip.timelineStart)
  const rightDuration = round3(clip.duration - leftDuration)

  const existingIds = new Set(track.clips.map((item) => item.id))
  let suffix = 1
  while (existingIds.has(`${clipId}-s${suffix}`)) suffix += 1

  const right: EditorClip = {
    ...(JSON.parse(JSON.stringify(clip)) as EditorClip),
    id: `${clipId}-s${suffix}`,
    timelineStart: round3(atTimelineSeconds),
    duration: rightDuration,
    ...(clip.media ? { trimStart: round3((clip.trimStart ?? 0) + leftDuration * speed) } : {}),
  }

  clip.duration = leftDuration
  delete clip.transitionAfter

  track.clips.push(right)
  assertNoOverlap(track)
  return next
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
