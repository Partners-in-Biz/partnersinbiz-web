import { reframeSettingsTo916, reframeTimelineTo916, REFRAME_TARGET } from '@/lib/video-editor/reframe'
import type { EditorTimeline } from '@/lib/video-editor/types'

const src = { width: 1920, height: 1080, fps: 30 as const, aspect: '16:9' as const, background: '#000000' }

const timeline: EditorTimeline = {
  version: 1,
  tracks: [{
    id: 't1',
    kind: 'video',
    clips: [{
      id: 'c1',
      timelineStart: 0,
      duration: 4,
      media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    }],
  }],
}

describe('reframeTimelineTo916', () => {
  it('produces 1080x1920 settings', () => {
    expect(REFRAME_TARGET).toEqual({ width: 1080, height: 1920, aspect: '9:16' })
    expect(reframeSettingsTo916(src)).toEqual({ ...src, width: 1080, height: 1920, aspect: '9:16' })
  })

  it('center-crops: scale is multiplied by dstHeight/srcHeight, x reset to 0', () => {
    const result = reframeTimelineTo916(timeline, src, {})
    const clip = result.tracks[0].clips[0]
    expect(clip.transform?.scale).toBeCloseTo(1920 / 1080, 3)
    expect(clip.transform?.x).toBe(0)
    expect(clip.keyframes).toBeUndefined()
  })

  it('converts a focus track into clamped transform.x keyframes', () => {
    const result = reframeTimelineTo916(timeline, src, { f1: [{ atSeconds: 0, x: 0.5 }, { atSeconds: 2, x: 1 }] })
    const clip = result.tracks[0].clips[0]
    const scale = clip.transform!.scale
    const maxOffset = (1920 * scale - 1080) / 2
    expect(clip.keyframes).toEqual([
      { property: 'transform.x', atSeconds: 0, value: -0, easing: 'ease_in_out' },
      { property: 'transform.x', atSeconds: 2, value: -maxOffset, easing: 'ease_in_out' },
    ])
  })

  it('scales transform.scale keyframes by the same cover factor as the static transform', () => {
    const keyed: EditorTimeline = {
      version: 1,
      tracks: [{
        id: 't1',
        kind: 'video',
        clips: [{
          ...timeline.tracks[0].clips[0],
          keyframes: [
            { property: 'transform.scale', atSeconds: 0, value: 1 },
            { property: 'transform.scale', atSeconds: 2, value: 1.5 },
          ],
        }],
      }],
    }
    const result = reframeTimelineTo916(keyed, src, {})
    expect(result.tracks[0].clips[0].keyframes).toEqual([
      { property: 'transform.scale', atSeconds: 0, value: 1.778 },
      { property: 'transform.scale', atSeconds: 2, value: 2.667 },
    ])
  })

  it('leaves text and audio clips untouched', () => {
    const withText: EditorTimeline = {
      version: 1,
      tracks: [{ id: 't-text', kind: 'text', clips: [{ id: 'c-t', timelineStart: 0, duration: 3, text: { content: 'Hi', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] }],
    }
    const result = reframeTimelineTo916(withText, src, {})
    expect(result.tracks[0].clips[0]).toEqual(withText.tracks[0].clips[0])
  })
})
