/**
 * Whisper-compatible transcription helpers for the executor.
 * Pure functions only — the HTTP orchestration lives in executor.mjs.
 */

/** Extract mono 16 kHz mp3 — small upload, ample quality for ASR. */
export function audioExtractArgs(inputPath, outputPath) {
  return ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', outputPath]
}

const round3 = (value) => Math.round(Number(value) * 1000) / 1000

/**
 * Map an OpenAI verbose_json transcription payload into the platform's
 * TranscriptSegment shape. Top-level `words` are assigned to segments by
 * time containment (word.start within [segment.start, segment.end)).
 */
export function segmentsFromVerboseJson(payload) {
  const rawSegments = Array.isArray(payload?.segments) ? payload.segments : []
  const rawWords = Array.isArray(payload?.words) ? payload.words : []
  const segments = rawSegments
    .filter((segment) => segment && typeof segment.start === 'number' && typeof segment.end === 'number' && String(segment.text ?? '').trim())
    .map((segment, index) => {
      const start = round3(Math.max(0, segment.start))
      const end = round3(Math.max(start, segment.end))
      const words = rawWords
        .filter((word) => word && typeof word.start === 'number' && typeof word.end === 'number'
          && String(word.word ?? '').trim() && word.start >= start - 0.001 && word.start < end)
        .map((word) => ({ text: String(word.word).trim(), start: round3(word.start), end: round3(word.end) }))
      return { id: `seg-${segment.id ?? index}`, start, end, text: String(segment.text).trim(), words }
    })
  return {
    language: typeof payload?.language === 'string' ? payload.language : undefined,
    durationSeconds: typeof payload?.duration === 'number' ? round3(payload.duration) : undefined,
    segments,
  }
}
