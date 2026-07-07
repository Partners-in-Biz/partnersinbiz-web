import { sourceBeatToTimelineSecond, timelineBeatPositions } from '@/lib/video-editor/beat-snapping'
import type { EditorClip, EditorTimeline } from '@/lib/video-editor/types'

function uploadClip(patch: Partial<EditorClip> = {}): EditorClip {
  return {
    id: 'clip-1',
    timelineStart: 10,
    duration: 4,
    media: { type: 'upload', fileId: 'upload-1', url: 'https://x.test/a.mp3', mediaKind: 'audio' },
    ...patch,
  }
}

describe('sourceBeatToTimelineSecond', () => {
  it('converts source beats through trim, speed, and timeline offset', () => {
    const clip = uploadClip({ trimStart: 2, speed: 2 })
    expect(sourceBeatToTimelineSecond(clip, 4)).toBe(11)
    expect(sourceBeatToTimelineSecond(clip, 1.5)).toBeNull()
  })

  it('handles speed-ramped clips with a monotonic inverse lookup', () => {
    const clip = uploadClip({
      duration: 4,
      keyframes: [
        { property: 'speed', atSeconds: 0, value: 1 },
        { property: 'speed', atSeconds: 2, value: 2 },
        { property: 'speed', atSeconds: 4, value: 2 },
      ],
    })
    expect(sourceBeatToTimelineSecond(clip, 1)).toBeGreaterThan(10.5)
    expect(sourceBeatToTimelineSecond(clip, 1)).toBeLessThan(11.5)
  })
})

describe('timelineBeatPositions', () => {
  it('returns sorted timeline positions for upload-backed clips only', () => {
    const timeline: EditorTimeline = {
      version: 1,
      tracks: [
        { id: 'audio', kind: 'audio', clips: [uploadClip({ id: 'a', timelineStart: 5 })] },
        { id: 'video', kind: 'video', clips: [uploadClip({ id: 'v', timelineStart: 1, media: { type: 'youtube_source_asset', sourceAssetId: 'yt-1', url: 'https://x.test/v.mp4', mediaKind: 'video' } })] },
      ],
    }
    expect(timelineBeatPositions(timeline, { 'upload-1': [0.5, 1.25] })).toEqual([5.5, 6.25])
  })
})
