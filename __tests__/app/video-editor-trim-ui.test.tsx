import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { TimelinePanel } from '@/components/video-editor/TimelinePanel'
import type { EditorTimeline } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [
    {
      id: 't1',
      kind: 'video',
      label: 'V1',
      clips: [
        { id: 'a', timelineStart: 0, duration: 4, media: { type: 'upload', fileId: 'f-a', url: 'https://x.test/a.mp4', mediaKind: 'video' } },
      ],
    },
  ],
}

function renderPanel(onTrimClip = jest.fn()) {
  const props = {
    timeline,
    selection: { trackId: 't1', clipIds: ['a'] },
    playheadSeconds: 0,
    pxPerSecond: 60,
    onSelectionChange: jest.fn(),
    onSeek: jest.fn(),
    onZoomChange: jest.fn(),
    onMoveClip: jest.fn(),
    onTrimClip,
    onSplitAtPlayhead: jest.fn(),
    onRemoveSelected: jest.fn(),
    onToggleTrackFlag: jest.fn(),
    onAddTrack: jest.fn(),
    onAddTextClip: jest.fn(),
  }
  render(<TimelinePanel {...props} />)
  return { onTrimClip }
}

describe('TimelinePanel trim handles', () => {
  it('renders start and end trim handles on selected clips', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Trim start of clip a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trim end of clip a' })).toBeInTheDocument()
  })

  it('commits a single start-edge trim after a pointer drag (px / pxPerSecond)', () => {
    const { onTrimClip } = renderPanel()
    const handle = screen.getByRole('button', { name: 'Trim start of clip a' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 160, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledTimes(1)
    expect(onTrimClip).toHaveBeenCalledWith('t1', 'a', 'start', 1) // 60px at 60 px/s
  })

  it('commits an end-edge trim with a negative delta when dragged left', () => {
    const { onTrimClip } = renderPanel()
    const handle = screen.getByRole('button', { name: 'Trim end of clip a' })
    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 180, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 180, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledWith('t1', 'a', 'end', -1)
  })

  it('ignores sub-threshold drags', () => {
    const { onTrimClip } = renderPanel()
    const handle = screen.getByRole('button', { name: 'Trim start of clip a' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 100, pointerId: 1 })
    expect(onTrimClip).not.toHaveBeenCalled()
  })

  it('nudges the trim with arrow keys, 0.1s per press and 1s with Shift', () => {
    const { onTrimClip } = renderPanel()
    const handle = screen.getByRole('button', { name: 'Trim start of clip a' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onTrimClip).toHaveBeenCalledWith('t1', 'a', 'start', 0.1)
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    expect(onTrimClip).toHaveBeenCalledWith('t1', 'a', 'start', -1)
  })

  it('still selects a clip when its body is clicked', () => {
    const onSelectionChange = jest.fn()
    render(
      <TimelinePanel
        timeline={timeline}
        selection={null}
        playheadSeconds={0}
        pxPerSecond={60}
        onSelectionChange={onSelectionChange}
        onSeek={jest.fn()}
        onZoomChange={jest.fn()}
        onMoveClip={jest.fn()}
        onTrimClip={jest.fn()}
        onSplitAtPlayhead={jest.fn()}
        onRemoveSelected={jest.fn()}
        onToggleTrackFlag={jest.fn()}
        onAddTrack={jest.fn()}
        onAddTextClip={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('timeline-clip-a'))
    expect(onSelectionChange).toHaveBeenCalledWith({ trackId: 't1', clipIds: ['a'] })
  })
})
