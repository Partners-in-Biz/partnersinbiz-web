import {
  VIDEO_EDITOR_COST_LABEL,
  VIDEO_EDITOR_CREDIT_RATE_PER_OUTPUT_MINUTE,
  VIDEO_EDITOR_UHD_MULTIPLIER,
  estimateEditorRenderCredits,
  timelineDurationSeconds,
} from '@/lib/video-editor/credits'
import { defaultVideoEditorSettings } from '@/lib/video-editor/types'
import type { EditorTimeline } from '@/lib/video-editor/types'

function timelineOf(ends: Array<[start: number, duration: number]>): EditorTimeline {
  return {
    version: 1,
    tracks: [{
      id: 't1',
      kind: 'video',
      clips: ends.map(([start, duration], index) => ({
        id: `c${index}`,
        timelineStart: start,
        duration,
        media: { type: 'upload', fileId: `f${index}`, url: 'https://x.test/a.mp4', mediaKind: 'video' as const },
      })),
    }],
  }
}

describe('video editor credits', () => {
  it('pins the registry constants', () => {
    expect(VIDEO_EDITOR_CREDIT_RATE_PER_OUTPUT_MINUTE).toBe(2)
    expect(VIDEO_EDITOR_UHD_MULTIPLIER).toBe(2)
    expect(VIDEO_EDITOR_COST_LABEL).toBe('video_editor_render')
  })

  it('computes timeline duration as the max clip end', () => {
    expect(timelineDurationSeconds(timelineOf([[0, 4], [4, 3]]))).toBe(7)
    expect(timelineDurationSeconds({ version: 1, tracks: [] })).toBe(0)
  })

  it('bills ceil(minutes) x rate at 1080p', () => {
    expect(estimateEditorRenderCredits(timelineOf([[0, 30]]), defaultVideoEditorSettings()))
      .toEqual({ outputSeconds: 30, billedMinutes: 1, credits: 2 })
    expect(estimateEditorRenderCredits(timelineOf([[0, 61]]), defaultVideoEditorSettings()))
      .toEqual({ outputSeconds: 61, billedMinutes: 2, credits: 4 })
  })

  it('doubles at 4K', () => {
    const uhd = { ...defaultVideoEditorSettings(), width: 3840, height: 2160 }
    expect(estimateEditorRenderCredits(timelineOf([[0, 61]]), uhd).credits).toBe(8)
    const vertical4k = { ...defaultVideoEditorSettings(), width: 2160, height: 3840, aspect: '9:16' as const }
    expect(estimateEditorRenderCredits(timelineOf([[0, 30]]), vertical4k).credits).toBe(4)
  })

  it('charges a minimum of one billed minute for any non-empty timeline', () => {
    expect(estimateEditorRenderCredits(timelineOf([[0, 0.5]]), defaultVideoEditorSettings()).billedMinutes).toBe(1)
    expect(estimateEditorRenderCredits({ version: 1, tracks: [] }, defaultVideoEditorSettings()))
      .toEqual({ outputSeconds: 0, billedMinutes: 0, credits: 0 })
  })
})
