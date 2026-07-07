import { fireEvent, render, screen } from '@testing-library/react'
import { TimelinePanel, trimDeltaFromDrag } from '@/components/video-editor/TimelinePanel'
import { WaveformStrip } from '@/components/video-editor/WaveformStrip'
import type { EditorTimeline, VideoEditorMediaPreview } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [{
    id: 'v1',
    kind: 'video',
    clips: [
      { id: 'a', timelineStart: 0, duration: 4, groupId: 'grp-1', media: { type: 'upload', fileId: 'f', url: 'https://x.test/a.mp4', mediaKind: 'video' }, keyframes: [{ property: 'transform.x', atSeconds: 1, value: 10 }] },
      { id: 'b', timelineStart: 4, duration: 3, media: { type: 'upload', fileId: 'f2', url: 'https://x.test/b.mp4', mediaKind: 'video' } },
    ],
  }],
}

function makeProps(overrides: Partial<Parameters<typeof TimelinePanel>[0]> = {}) {
  return {
    timeline,
    selection: [{ trackId: 'v1', clipId: 'a' }],
    playheadSeconds: 0,
    pxPerSecond: 60,
    editMode: 'select' as const,
    mediaPreviews: {},
    onEditModeChange: jest.fn(),
    onSelectionChange: jest.fn(),
    onSeek: jest.fn(),
    onZoomChange: jest.fn(),
    onMoveClip: jest.fn(),
    onTrimClip: jest.fn(),
    onRollEdit: jest.fn(),
    onSlipClip: jest.fn(),
    onSplitAtPlayhead: jest.fn(),
    onRemoveSelected: jest.fn(),
    onLinkSelection: jest.fn(),
    onUnlinkSelection: jest.fn(),
    onToggleTrackFlag: jest.fn(),
    onAddTrack: jest.fn(),
    onAddTextClip: jest.fn(),
    ...overrides,
  }
}

describe('trimDeltaFromDrag', () => {
  it('converts pixel drags to second deltas per edge', () => {
    expect(trimDeltaFromDrag('end', 30, 60)).toBe(0.5)
    expect(trimDeltaFromDrag('end', -30, 60)).toBe(-0.5)
    expect(trimDeltaFromDrag('start', 30, 60)).toBe(0.5) // dragging the start handle right trims away
  })
})

describe('TimelinePanel mechanics', () => {
  it('shows edit mode buttons and reports mode changes', () => {
    const props = makeProps()
    render(<TimelinePanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ripple mode' }))
    expect(props.onEditModeChange).toHaveBeenCalledWith('ripple')
    fireEvent.click(screen.getByRole('button', { name: 'Roll mode' }))
    expect(props.onEditModeChange).toHaveBeenCalledWith('roll')
    fireEvent.click(screen.getByRole('button', { name: 'Slip mode' }))
    expect(props.onEditModeChange).toHaveBeenCalledWith('slip')
  })

  it('renders trim handles on selected clips and fires onTrimClip after a drag', () => {
    const props = makeProps()
    render(<TimelinePanel {...props} />)
    const handle = screen.getByTestId('trim-handle-end-a')
    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 })
    expect(props.onTrimClip).toHaveBeenCalledWith('v1', 'a', 'end', 1)
  })

  it('routes a start-handle drag to onRollEdit in roll mode', () => {
    const props = makeProps({ editMode: 'roll', selection: [{ trackId: 'v1', clipId: 'b' }] })
    render(<TimelinePanel {...props} />)
    const handle = screen.getByTestId('trim-handle-start-b')
    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 180, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 180, pointerId: 1 })
    expect(props.onRollEdit).toHaveBeenCalledWith('v1', 'a', 'b', -1)
  })

  it('routes a body drag to onSlipClip in slip mode', () => {
    const props = makeProps({ editMode: 'slip' })
    render(<TimelinePanel {...props} />)
    const body = screen.getByTestId('timeline-clip-a')
    fireEvent.pointerDown(body, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(body, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(body, { clientX: 160, pointerId: 1 })
    expect(props.onSlipClip).toHaveBeenCalledWith('v1', 'a', 1)
  })

  it('shift-click extends the selection and link/unlink buttons reflect it', () => {
    const props = makeProps()
    render(<TimelinePanel {...props} />)
    fireEvent.click(screen.getByTestId('timeline-clip-b'), { shiftKey: true })
    expect(props.onSelectionChange).toHaveBeenCalledWith([
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'v1', clipId: 'b' },
    ])
    // selected clip 'a' is grouped → Unlink enabled
    expect(screen.getByRole('button', { name: 'Unlink clips' })).toBeEnabled()
  })

  it('renders keyframe markers and a group badge', () => {
    render(<TimelinePanel {...makeProps()} />)
    expect(screen.getByTestId('keyframe-marker-a-0')).toBeInTheDocument()
    expect(screen.getByTestId('group-badge-a')).toBeInTheDocument()
  })
})

describe('TimelinePanel media previews', () => {
  const previews: Record<string, VideoEditorMediaPreview> = {
    'upload:f': {
      orgId: 'o', mediaKey: 'upload:f', sourceUrl: 'https://x.test/a.mp4', mediaKind: 'video', status: 'ready', deleted: false,
      filmstrip: { url: 'https://x.test/strip.jpg', storagePath: 'p', frameIntervalSeconds: 1, frameWidth: 160, frameHeight: 90, frameCount: 4 },
    },
  }

  it('paints the filmstrip as the clip background when available', () => {
    render(<TimelinePanel {...makeProps({ mediaPreviews: previews })} />)
    const clipEl = screen.getByTestId('timeline-clip-a')
    expect(clipEl.style.backgroundImage).toContain('strip.jpg')
  })
})

describe('WaveformStrip', () => {
  it('fetches the peaks JSON and renders a canvas', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ peaks: [0.1, 0.9, 0.4] }) }) as jest.Mock
    render(<WaveformStrip waveformUrl="https://x.test/w.json" />)
    expect(await screen.findByTestId('waveform-canvas')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('https://x.test/w.json')
  })
})
