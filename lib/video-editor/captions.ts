import type {
  EditorCaptionAnimationPreset,
  EditorCaptionStylePreset,
  EditorClip,
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
