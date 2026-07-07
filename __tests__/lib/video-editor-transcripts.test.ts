import {
  sanitizeTranscriptSegments,
  sanitizeTranscriptReportPatch,
  transcriptPlainText,
} from '@/lib/video-editor/transcripts'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'

describe('transcript sanitizers', () => {
  it('registers the transcripts and tts-jobs collections', () => {
    expect(VIDEO_EDITOR_COLLECTIONS.transcripts).toBe('video_editor_transcripts')
    expect(VIDEO_EDITOR_COLLECTIONS.ttsJobs).toBe('video_editor_tts_jobs')
  })

  it('sanitizes segments, drops invalid words, clamps times', () => {
    const segments = sanitizeTranscriptSegments([
      {
        id: 's1', start: -1, end: 2.5, text: ' Hello world ',
        words: [
          { text: 'Hello', start: 0, end: 0.5 },
          { text: 'world', start: 0.6, end: 1.1 },
          { text: '', start: 1, end: 2 },
          { text: 'bad', start: 3, end: 2 },
        ],
      },
      { id: '', start: 0, end: 1, text: 'dropped — no id', words: [] },
      { id: 's2', start: 3, end: 2, text: 'dropped — inverted', words: [] },
    ])
    expect(segments).toEqual([{
      id: 's1', start: 0, end: 2.5, text: 'Hello world',
      words: [
        { text: 'Hello', start: 0, end: 0.5 },
        { text: 'world', start: 0.6, end: 1.1 },
      ],
    }])
  })

  it('accepts a completed executor report and requires segments', () => {
    const patch = sanitizeTranscriptReportPatch({
      status: 'completed',
      language: ' en ',
      durationSeconds: 12.2,
      segments: [{ id: 's1', start: 0, end: 1, text: 'Hi', words: [{ text: 'Hi', start: 0, end: 1 }] }],
    })
    expect(patch.status).toBe('completed')
    expect(patch.language).toBe('en')
    expect(patch.durationSeconds).toBe(12.2)
    expect(patch.segments).toHaveLength(1)

    expect(sanitizeTranscriptReportPatch({ status: 'completed', segments: [] }).status).toBeUndefined()
    expect(sanitizeTranscriptReportPatch({ status: 'nonsense' }).status).toBeUndefined()
  })

  it('accepts processing and failed reports', () => {
    expect(sanitizeTranscriptReportPatch({ status: 'processing' })).toEqual({ status: 'processing' })
    const failed = sanitizeTranscriptReportPatch({ status: 'failed', error: { code: 'x', message: 'boom' } })
    expect(failed).toEqual({ status: 'failed', error: { code: 'x', message: 'boom' } })
    expect(sanitizeTranscriptReportPatch({ status: 'failed' }).error).toEqual({ code: 'transcription_failed', message: 'Transcription failed.' })
  })

  it('joins segment text into plain text', () => {
    expect(transcriptPlainText([
      { id: 's1', start: 0, end: 1, text: 'Hello world.', words: [] },
      { id: 's2', start: 1, end: 2, text: 'Second line.', words: [] },
    ])).toBe('Hello world. Second line.')
  })
})
