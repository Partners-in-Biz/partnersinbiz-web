import { render, screen } from '@testing-library/react'
import { PreviewPlayer, visibleClipsAt } from '@/components/video-editor/PreviewPlayer'
import type { EditorTimeline, VideoEditorMediaPreview } from '@/lib/video-editor/types'

Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: jest.fn().mockResolvedValue(undefined) })
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: jest.fn() })

const timeline: EditorTimeline = {
  version: 1,
  tracks: [
    {
      id: 'v1',
      kind: 'video',
      clips: [{
        id: 'c1', timelineStart: 0, duration: 4, trimStart: 1,
        media: { type: 'upload', fileId: 'f1', url: 'https://x.test/original.mp4', mediaKind: 'video' },
        keyframes: [
          { property: 'transform.opacity', atSeconds: 0, value: 1 },
          { property: 'transform.opacity', atSeconds: 4, value: 0 },
        ],
      }],
    },
    { id: 't1', kind: 'text', clips: [{ id: 'x1', timelineStart: 0, duration: 2, text: { content: 'Hello', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] },
  ],
}

const settings = { width: 1920, height: 1080, fps: 30 as const, aspect: '16:9' as const, background: '#000000' }

const previews: Record<string, VideoEditorMediaPreview> = {
  'upload:f1': {
    orgId: 'o', mediaKey: 'upload:f1', sourceUrl: 'https://x.test/original.mp4', mediaKind: 'video', status: 'ready', deleted: false,
    proxy: { url: 'https://x.test/proxy-540.mp4', storagePath: 'p', sizeBytes: 1, width: 960, height: 540 },
  },
}

describe('visibleClipsAt', () => {
  it('returns visual clips under the playhead with their track kind', () => {
    expect(visibleClipsAt(timeline, 1).map((entry) => entry.clip.id)).toEqual(['c1', 'x1'])
    expect(visibleClipsAt(timeline, 3).map((entry) => entry.clip.id)).toEqual(['c1'])
    expect(visibleClipsAt(timeline, 9)).toEqual([])
  })
})

describe('PreviewPlayer', () => {
  it('renders active video clips through their proxy URL with keyframed opacity', () => {
    render(<PreviewPlayer timeline={timeline} settings={settings} mediaPreviews={previews} playheadSeconds={2} playing={false} onPlayToggle={jest.fn()} onSeek={jest.fn()} />)
    const video = screen.getByTestId('preview-video-c1') as HTMLVideoElement
    expect(video.src).toBe('https://x.test/proxy-540.mp4')
    expect(video.parentElement?.style.opacity).toBe('0.5')
  })

  it('falls back to the original URL without a proxy and shows active text', () => {
    render(<PreviewPlayer timeline={timeline} settings={settings} mediaPreviews={{}} playheadSeconds={1} playing={false} onPlayToggle={jest.fn()} onSeek={jest.fn()} />)
    expect((screen.getByTestId('preview-video-c1') as HTMLVideoElement).src).toBe('https://x.test/original.mp4')
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
