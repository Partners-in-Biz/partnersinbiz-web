import {
  collectCaptionCues,
  cuesFromSegments,
  captionClipsFromTranscript,
  distributeWordsAcrossSpan,
  mergeCaptionCueWithNext,
  nudgeCaptionCue,
  serializeSrt,
  serializeVtt,
  splitCaptionCue,
} from '@/lib/video-editor/captions'
import type { EditorTimeline, TranscriptSegment, VideoEditorTranscript } from '@/lib/video-editor/types'

function seg(id: string, start: number, end: number, text: string, words: Array<[string, number, number]>): TranscriptSegment {
  return { id, start, end, text, words: words.map(([t, s, e]) => ({ text: t, start: s, end: e })) }
}

describe('cuesFromSegments', () => {
  it('groups words into cues and breaks on max chars', () => {
    const words: Array<[string, number, number]> = []
    for (let i = 0; i < 20; i += 1) words.push([`word${i}`, i * 0.3, i * 0.3 + 0.25])
    const cues = cuesFromSegments([seg('s1', 0, 6, words.map(([t]) => t).join(' '), words)], { maxCharsPerCue: 24 })
    expect(cues.length).toBeGreaterThan(1)
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(24)
      expect(cue.end).toBeGreaterThan(cue.start)
      expect(cue.words.length).toBeGreaterThan(0)
    }
    // No word lost, order preserved
    expect(cues.flatMap((c) => c.words.map((w) => w.text))).toEqual(words.map(([t]) => t))
  })

  it('breaks on silence gaps and sentence punctuation', () => {
    const cues = cuesFromSegments([
      seg('s1', 0, 5, 'Hello there. After a pause', [
        ['Hello', 0, 0.4], ['there.', 0.5, 0.9],
        ['After', 2.5, 2.9], ['a', 3.0, 3.1], ['pause', 3.2, 3.6],
      ]),
    ], { gapBreakSeconds: 0.6 })
    expect(cues.map((c) => c.text)).toEqual(['Hello there.', 'After a pause'])
    expect(cues[1].start).toBe(2.5)
  })

  it('falls back to whole segments when a segment has no words', () => {
    const cues = cuesFromSegments([seg('s1', 1, 3, 'No word timing here', [])], {})
    expect(cues).toEqual([{
      start: 1, end: 3, text: 'No word timing here',
      words: distributeWordsAcrossSpan('No word timing here', 1, 3),
    }])
  })
})

describe('distributeWordsAcrossSpan', () => {
  it('distributes proportionally to word length and covers the span', () => {
    const words = distributeWordsAcrossSpan('a bb ccc', 10, 16)
    expect(words.map((w) => w.text)).toEqual(['a', 'bb', 'ccc'])
    expect(words[0].start).toBe(10)
    expect(words[2].end).toBe(16)
    expect(words[1].start).toBeCloseTo(words[0].end, 5)
    // longer words get more time
    expect(words[2].end - words[2].start).toBeGreaterThan(words[0].end - words[0].start)
  })
  it('returns [] for empty text or inverted spans', () => {
    expect(distributeWordsAcrossSpan('', 0, 1)).toEqual([])
    expect(distributeWordsAcrossSpan('x', 2, 1)).toEqual([])
  })
})

describe('captionClipsFromTranscript', () => {
  const transcript = {
    id: 'tr-1', orgId: 'o', projectId: 'p', source: 'media', status: 'completed', language: 'en',
    segments: [seg('s1', 0.5, 2.0, 'Hello world', [['Hello', 0.5, 1.0], ['world', 1.2, 1.9]])],
    text: 'Hello world', provider: 'gateway', alignment: 'provider',
    credits: { estimated: 1, charged: 1, refunded: 0 }, deleted: false,
  } as VideoEditorTranscript & { id: string }

  it('produces caption clips with clip-relative word offsets', () => {
    const clips = captionClipsFromTranscript(transcript, { stylePreset: 'boxed', animationPreset: 'karaoke', idPrefix: 'cap-tr-1' })
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({
      id: 'cap-tr-1-1',
      timelineStart: 0.5,
      duration: 1.5,
      caption: {
        text: 'Hello world',
        stylePreset: 'boxed',
        animationPreset: 'karaoke',
        transcriptId: 'tr-1',
        language: 'en',
        words: [
          { text: 'Hello', offsetStart: 0, offsetEnd: 0.5 },
          { text: 'world', offsetStart: 0.7, offsetEnd: 1.4 },
        ],
      },
    })
  })
})

function captionTimeline(): EditorTimeline {
  return {
    version: 1,
    tracks: [{
      id: 'track-caption-1',
      kind: 'caption',
      clips: [
        {
          id: 'cue-1', timelineStart: 1, duration: 2,
          caption: {
            text: 'Hello there world', stylePreset: 'clean', animationPreset: 'none',
            words: [
              { text: 'Hello', offsetStart: 0, offsetEnd: 0.5 },
              { text: 'there', offsetStart: 0.6, offsetEnd: 1.1 },
              { text: 'world', offsetStart: 1.3, offsetEnd: 1.9 },
            ],
          },
        },
        {
          id: 'cue-2', timelineStart: 3.5, duration: 1,
          caption: {
            text: 'Second cue', stylePreset: 'clean', animationPreset: 'none',
            words: [
              { text: 'Second', offsetStart: 0, offsetEnd: 0.4 },
              { text: 'cue', offsetStart: 0.5, offsetEnd: 0.9 },
            ],
          },
        },
      ],
    }],
  }
}

describe('caption cue ops', () => {
  it('splits a cue at the nearest word boundary', () => {
    const next = splitCaptionCue(captionTimeline(), 'track-caption-1', 'cue-1', 1.65)
    const clips = next.tracks[0].clips
    expect(clips).toHaveLength(3)
    expect(clips[0].caption!.text).toBe('Hello')
    expect(clips[0].duration).toBeCloseTo(0.6, 3)
    expect(clips[1].id).toBe('cue-1-s1')
    expect(clips[1].caption!.text).toBe('there world')
    expect(clips[1].timelineStart).toBeCloseTo(1.6, 3)
    expect(clips[1].caption!.words[0]).toEqual({ text: 'there', offsetStart: 0, offsetEnd: 0.5 })
  })

  it('refuses to split a one-word cue', () => {
    const one = captionTimeline()
    one.tracks[0].clips[0].caption!.words = [{ text: 'Hello', offsetStart: 0, offsetEnd: 1.9 }]
    one.tracks[0].clips[0].caption!.text = 'Hello'
    expect(() => splitCaptionCue(one, 'track-caption-1', 'cue-1', 1.5)).toThrow('at least two words')
  })

  it('merges a cue with the next one', () => {
    const next = mergeCaptionCueWithNext(captionTimeline(), 'track-caption-1', 'cue-1')
    const clips = next.tracks[0].clips
    expect(clips).toHaveLength(1)
    expect(clips[0].caption!.text).toBe('Hello there world Second cue')
    expect(clips[0].timelineStart).toBe(1)
    expect(clips[0].duration).toBeCloseTo(3.5, 3) // ends where cue-2 ended (4.5)
    // cue-2 words re-offset against cue-1 start: 3.5 - 1 = 2.5
    expect(clips[0].caption!.words[3]).toEqual({ text: 'Second', offsetStart: 2.5, offsetEnd: 2.9 })
  })

  it('nudges a cue and rejects overlaps', () => {
    const next = nudgeCaptionCue(captionTimeline(), 'track-caption-1', 'cue-2', -0.3)
    expect(next.tracks[0].clips[1].timelineStart).toBeCloseTo(3.2, 3)
    expect(() => nudgeCaptionCue(captionTimeline(), 'track-caption-1', 'cue-2', -1)).toThrow('overlap')
  })
})

describe('sidecar serializers', () => {
  it('collects absolute cues from caption tracks', () => {
    const cues = collectCaptionCues(captionTimeline())
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1, 3, 'Hello there world'],
      [3.5, 4.5, 'Second cue'],
    ])
  })
  it('serializes SRT', () => {
    expect(serializeSrt(collectCaptionCues(captionTimeline()))).toBe(
      '1\n00:00:01,000 --> 00:00:03,000\nHello there world\n\n2\n00:00:03,500 --> 00:00:04,500\nSecond cue\n',
    )
  })
  it('serializes VTT', () => {
    expect(serializeVtt(collectCaptionCues(captionTimeline()))).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello there world\n\n00:00:03.500 --> 00:00:04.500\nSecond cue\n',
    )
  })
})
