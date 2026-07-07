import type { TranscriptSegment, TranscriptWord, VideoEditorTranscriptStatus } from './types'

type PlainRecord = Record<string, unknown>

function cleanObject(value: unknown): PlainRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PlainRecord) : {}
}
function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sanitizeWords(value: unknown): TranscriptWord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const source = cleanObject(entry)
    const text = cleanString(source.text)
    const start = cleanNumber(source.start)
    const end = cleanNumber(source.end)
    if (!text || start === undefined || end === undefined || end < start) return []
    return [{ text, start: Math.max(0, start), end: Math.max(0, end) }]
  })
}

export function sanitizeTranscriptSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const source = cleanObject(entry)
    const id = cleanString(source.id)
    const start = cleanNumber(source.start)
    const end = cleanNumber(source.end)
    const text = cleanString(source.text)
    if (!id || start === undefined || end === undefined || !text) return []
    const safeStart = Math.max(0, start)
    if (end < safeStart) return []
    return [{ id, start: safeStart, end, text, words: sanitizeWords(source.words) }]
  })
}

export function transcriptPlainText(segments: TranscriptSegment[]): string {
  return segments.map((segment) => segment.text).join(' ').trim()
}

const REPORT_STATUSES: VideoEditorTranscriptStatus[] = ['processing', 'completed', 'failed']

export interface TranscriptReportPatch {
  status?: 'processing' | 'completed' | 'failed'
  segments?: TranscriptSegment[]
  language?: string
  durationSeconds?: number
  error?: { code: string; message: string }
}

/**
 * Sanitizes the executor's PUT report. A `completed` report without at least
 * one valid segment is rejected (status stripped) so an empty provider
 * response can never overwrite a transcript as "done".
 */
export function sanitizeTranscriptReportPatch(value: unknown): TranscriptReportPatch {
  const source = cleanObject(value)
  const status = REPORT_STATUSES.includes(source.status as VideoEditorTranscriptStatus)
    ? (source.status as TranscriptReportPatch['status'])
    : undefined

  if (status === 'processing') return { status: 'processing' }

  if (status === 'completed') {
    const segments = sanitizeTranscriptSegments(source.segments)
    if (!segments.length) return {}
    const patch: TranscriptReportPatch = { status: 'completed', segments }
    const language = cleanString(source.language)
    if (language) patch.language = language
    const durationSeconds = cleanNumber(source.durationSeconds)
    if (durationSeconds !== undefined && durationSeconds >= 0) patch.durationSeconds = durationSeconds
    return patch
  }

  if (status === 'failed') {
    const errorSource = cleanObject(source.error)
    return {
      status: 'failed',
      error: {
        code: cleanString(errorSource.code) ?? 'transcription_failed',
        message: (cleanString(errorSource.message) ?? 'Transcription failed.').slice(0, 4000),
      },
    }
  }
  return {}
}

/**
 * Firestore docs cap at ~1 MiB. If the segments (with words) would blow the
 * cap, drop word arrays (keep cue-level timing) and flag it.
 */
export function fitSegmentsForFirestore(segments: TranscriptSegment[]): { segments: TranscriptSegment[]; wordsTruncated: boolean } {
  if (JSON.stringify(segments).length <= 850_000) return { segments, wordsTruncated: false }
  return { segments: segments.map((segment) => ({ ...segment, words: [] })), wordsTruncated: true }
}
