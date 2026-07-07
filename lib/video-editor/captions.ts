import type {
  EditorCaptionAnimationPreset,
  EditorCaptionStylePreset,
  EditorClip,
  EditorTimeline,
  EditorTrack,
  TranscriptSegment,
  TranscriptWord,
  VideoEditorTranscript,
} from './types'

export interface CaptionCue {
  /** Absolute timeline seconds. */
  start: number
  end: number
  text: string
  words: TranscriptWord[]
}

export interface CueOptions {
  maxCharsPerCue?: number
  maxCueDurationSeconds?: number
  gapBreakSeconds?: number
}

const DEFAULT_MAX_CHARS = 42
const DEFAULT_MAX_DURATION = 5
const DEFAULT_GAP_BREAK = 0.6
const MIN_CUE_DURATION = 0.2

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Estimated word timing when a provider gives none (Gateway TTS, wordless
 * segments): distribute the span across words proportionally to
 * (characters + 1) so longer words hold longer.
 */
export function distributeWordsAcrossSpan(text: string, startSeconds: number, endSeconds: number): TranscriptWord[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  const span = endSeconds - startSeconds
  if (!tokens.length || !(span > 0)) return []
  const weights = tokens.map((token) => token.length + 1)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const words: TranscriptWord[] = []
  let cursor = startSeconds
  tokens.forEach((token, index) => {
    const slice = (weights[index] / total) * span
    const end = index === tokens.length - 1 ? endSeconds : cursor + slice
    words.push({ text: token, start: round3(cursor), end: round3(end) })
    cursor = end
  })
  return words
}

function flushCue(cues: CaptionCue[], words: TranscriptWord[], segmentEnd?: number) {
  if (!words.length) return
  const lastWordEnd = words[words.length - 1].end
  const naturalEnd = segmentEnd !== undefined ? Math.max(lastWordEnd, segmentEnd) : lastWordEnd
  cues.push({
    start: round3(words[0].start),
    end: round3(Math.max(naturalEnd, words[0].start + MIN_CUE_DURATION)),
    text: words.map((word) => word.text).join(' '),
    words: [...words],
  })
  words.length = 0
}

/**
 * Chunk transcript words into readable cues. Break when adding a word would
 * exceed maxChars or maxDuration, after a silence gap, or after sentence-final
 * punctuation once the cue has some substance.
 */
export function cuesFromSegments(segments: TranscriptSegment[], options: CueOptions = {}): CaptionCue[] {
  const maxChars = options.maxCharsPerCue ?? DEFAULT_MAX_CHARS
  const maxDuration = options.maxCueDurationSeconds ?? DEFAULT_MAX_DURATION
  const gapBreak = options.gapBreakSeconds ?? DEFAULT_GAP_BREAK
  const cues: CaptionCue[] = []
  const pending: TranscriptWord[] = []

  for (const segment of segments) {
    const words = segment.words.length ? segment.words : distributeWordsAcrossSpan(segment.text, segment.start, segment.end)
    for (const word of words) {
      if (pending.length) {
        const previous = pending[pending.length - 1]
        const nextText = `${pending.map((w) => w.text).join(' ')} ${word.text}`
        const nextDuration = word.end - pending[0].start
        const gap = word.start - previous.end
        const sentenceEnd = /[.!?]$/.test(previous.text) && pending.map((w) => w.text).join(' ').length >= 12
        if (nextText.length > maxChars || nextDuration > maxDuration || gap > gapBreak || sentenceEnd) {
          flushCue(cues, pending)
        }
      }
      pending.push(word)
    }
    // The final cue of a segment should reach the segment's own end time,
    // even if the last word's timestamp ends slightly earlier.
    flushCue(cues, pending, segment.end)
  }
  return cues
}

export function captionClipsFromTranscript(
  transcript: VideoEditorTranscript & { id: string },
  options: {
    stylePreset: EditorCaptionStylePreset
    animationPreset: EditorCaptionAnimationPreset
    idPrefix: string
    cueOptions?: CueOptions
  },
): EditorClip[] {
  const cues = cuesFromSegments(transcript.segments ?? [], options.cueOptions ?? {})
  return cues.map((cue, index) => ({
    id: `${options.idPrefix}-${index + 1}`,
    timelineStart: cue.start,
    duration: round3(Math.max(cue.end - cue.start, MIN_CUE_DURATION)),
    caption: {
      text: cue.text,
      words: cue.words.map((word) => ({
        text: word.text,
        offsetStart: round3(Math.max(0, word.start - cue.start)),
        offsetEnd: round3(Math.max(0, word.end - cue.start)),
      })),
      stylePreset: options.stylePreset,
      animationPreset: options.animationPreset,
      transcriptId: transcript.id,
      language: transcript.language,
    },
  }))
}

export class CaptionOpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptionOpError'
  }
}

function cloneTimeline(timeline: EditorTimeline): EditorTimeline {
  return JSON.parse(JSON.stringify(timeline)) as EditorTimeline
}

function findCaptionClip(timeline: EditorTimeline, trackId: string, clipId: string) {
  const track = timeline.tracks.find((item) => item.id === trackId)
  if (!track || track.kind !== 'caption') throw new CaptionOpError(`Caption track '${trackId}' not found.`)
  const index = track.clips.findIndex((item) => item.id === clipId)
  if (index < 0 || !track.clips[index].caption) throw new CaptionOpError(`Caption cue '${clipId}' not found.`)
  return { track, index }
}

function assertNoCaptionOverlap(track: EditorTrack) {
  const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
  let previousEnd = -Infinity
  let previousId = ''
  for (const clip of sorted) {
    if (clip.timelineStart < previousEnd - 0.0005) {
      throw new CaptionOpError(`Cues '${previousId}' and '${clip.id}' overlap on track '${track.id}'.`)
    }
    previousEnd = clip.timelineStart + clip.duration
    previousId = clip.id
  }
  track.clips = sorted
}

/** Split at the word boundary nearest to atTimelineSeconds. */
export function splitCaptionCue(timeline: EditorTimeline, trackId: string, clipId: string, atTimelineSeconds: number): EditorTimeline {
  const next = cloneTimeline(timeline)
  const { track, index } = findCaptionClip(next, trackId, clipId)
  const clip = track.clips[index]
  const words = clip.caption!.words
  if (words.length < 2) throw new CaptionOpError('Splitting a cue requires at least two words.')

  const targetOffset = atTimelineSeconds - clip.timelineStart
  let splitAt = 1
  let best = Infinity
  for (let i = 1; i < words.length; i += 1) {
    const distance = Math.abs(words[i].offsetStart - targetOffset)
    if (distance < best) { best = distance; splitAt = i }
  }

  const leftWords = words.slice(0, splitAt)
  const rightWords = words.slice(splitAt)
  const rightStartOffset = rightWords[0].offsetStart
  const originalEnd = clip.timelineStart + clip.duration

  const existingIds = new Set(track.clips.map((item) => item.id))
  let suffix = 1
  while (existingIds.has(`${clipId}-s${suffix}`)) suffix += 1

  const right = {
    ...(JSON.parse(JSON.stringify(clip)) as typeof clip),
    id: `${clipId}-s${suffix}`,
    timelineStart: round3(clip.timelineStart + rightStartOffset),
    duration: round3(originalEnd - (clip.timelineStart + rightStartOffset)),
  }
  right.caption = {
    ...clip.caption!,
    text: rightWords.map((word) => word.text).join(' '),
    words: rightWords.map((word) => ({
      text: word.text,
      offsetStart: round3(word.offsetStart - rightStartOffset),
      offsetEnd: round3(word.offsetEnd - rightStartOffset),
    })),
  }

  clip.duration = round3(rightStartOffset)
  clip.caption = { ...clip.caption!, text: leftWords.map((word) => word.text).join(' '), words: leftWords }

  track.clips.splice(index + 1, 0, right)
  assertNoCaptionOverlap(track)
  return next
}

export function mergeCaptionCueWithNext(timeline: EditorTimeline, trackId: string, clipId: string): EditorTimeline {
  const next = cloneTimeline(timeline)
  const { track, index } = findCaptionClip(next, trackId, clipId)
  const clip = track.clips[index]
  const sibling = track.clips[index + 1]
  if (!sibling?.caption) throw new CaptionOpError('There is no next cue to merge with.')

  const shift = sibling.timelineStart - clip.timelineStart
  clip.caption = {
    ...clip.caption!,
    text: `${clip.caption!.text} ${sibling.caption.text}`,
    words: [
      ...clip.caption!.words,
      ...sibling.caption.words.map((word) => ({
        text: word.text,
        offsetStart: round3(word.offsetStart + shift),
        offsetEnd: round3(word.offsetEnd + shift),
      })),
    ],
  }
  clip.duration = round3(shift + sibling.duration)
  track.clips.splice(index + 1, 1)
  assertNoCaptionOverlap(track)
  return next
}

export function nudgeCaptionCue(timeline: EditorTimeline, trackId: string, clipId: string, deltaSeconds: number): EditorTimeline {
  const next = cloneTimeline(timeline)
  const { track, index } = findCaptionClip(next, trackId, clipId)
  const clip = track.clips[index]
  clip.timelineStart = round3(Math.max(0, clip.timelineStart + deltaSeconds))
  assertNoCaptionOverlap(track)
  return next
}

export function collectCaptionCues(timeline: EditorTimeline, trackId?: string): CaptionCue[] {
  const cues: CaptionCue[] = []
  for (const track of timeline.tracks ?? []) {
    if (track.kind !== 'caption') continue
    if (trackId && track.id !== trackId) continue
    for (const clip of track.clips ?? []) {
      if (!clip.caption) continue
      cues.push({
        start: clip.timelineStart,
        end: round3(clip.timelineStart + clip.duration),
        text: clip.caption.text,
        words: clip.caption.words.map((word) => ({
          text: word.text,
          start: round3(clip.timelineStart + word.offsetStart),
          end: round3(clip.timelineStart + word.offsetEnd),
        })),
      })
    }
  }
  return cues.sort((a, b) => a.start - b.start)
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function clockParts(seconds: number) {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  return { h, m, s, ms }
}

export function formatSrtTime(seconds: number): string {
  const { h, m, s, ms } = clockParts(seconds)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

export function formatVttTime(seconds: number): string {
  const { h, m, s, ms } = clockParts(seconds)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`
}

export function serializeSrt(cues: CaptionCue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}\n`)
    .join('\n')
}

export function serializeVtt(cues: CaptionCue[]): string {
  const body = cues
    .map((cue) => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}\n`)
    .join('\n')
  return `WEBVTT\n\n${body}`
}
