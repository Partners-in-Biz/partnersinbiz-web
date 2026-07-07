import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TimelinePanel } from '@/components/video-editor/TimelinePanel'
import { InspectorPanel } from '@/components/video-editor/InspectorPanel'
import { VideoEditorShell } from '@/components/video-editor/VideoEditorShell'
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

describe('InspectorPanel trim fields', () => {
  const settings = { width: 1920, height: 1080, fps: 30 as const, aspect: '16:9' as const, background: '#000000' }
  const clip = {
    id: 'a',
    timelineStart: 2,
    duration: 4,
    media: { type: 'upload' as const, fileId: 'f-a', url: 'https://x.test/a.mp4', mediaKind: 'video' as const },
  }
  const renderInspector = (props: Partial<React.ComponentProps<typeof InspectorPanel>> = {}) => render(
    <InspectorPanel
      clip={clip}
      settings={settings}
      onPatch={jest.fn()}
      onApplyLayout={jest.fn()}
      {...props}
    />,
  )

  it('converts an in-point change into a start trim delta', () => {
    const onTrim = jest.fn()
    renderInspector({ onTrim })
    const inPoint = screen.getByLabelText('In point (s)')
    expect(inPoint).toHaveValue(2)
    fireEvent.change(inPoint, { target: { value: '2.5' } })
    expect(onTrim).toHaveBeenCalledWith('start', 0.5)
  })

  it('converts an out-point change into an end trim delta', () => {
    const onTrim = jest.fn()
    renderInspector({ onTrim })
    const outPoint = screen.getByLabelText('Out point (s)')
    expect(outPoint).toHaveValue(6)
    fireEvent.change(outPoint, { target: { value: '5' } })
    expect(onTrim).toHaveBeenCalledWith('end', -1)
  })

  it('hides trim fields when onTrim is not provided', () => {
    renderInspector()
    expect(screen.queryByLabelText('In point (s)')).not.toBeInTheDocument()
  })
})

describe('VideoEditorShell trim wiring', () => {
  const project = {
    id: 'proj-1',
    orgId: 'org-1',
    title: 'Demo edit',
    timeline: {
      version: 1,
      tracks: [
        {
          id: 't1',
          kind: 'video',
          label: 'V1',
          clips: [{ id: 'a', timelineStart: 0, duration: 4, media: { type: 'upload', fileId: 'f-a', url: 'https://x.test/a.mp4', mediaKind: 'video' } }],
        },
      ],
    },
  }

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/video-editor/projects/proj-1') && (!init?.method || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { project } }) } as Response
      }
      if (url.includes('/api/v1/video-editor/render-jobs')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { jobs: [] } }) } as Response
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response
    }) as jest.Mock
  })

  it('persists a trimmed timeline when a trim handle drag commits', async () => {
    render(<VideoEditorShell projectId="proj-1" orgId="org-1" />)
    const handle = await screen.findByRole('button', { name: 'Trim start of clip a' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 160, pointerId: 1 })

    await waitFor(() => {
      const putCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
        String(url).includes('/api/v1/video-editor/projects/proj-1') && init?.method === 'PUT')
      expect(putCall).toBeTruthy()
      const body = JSON.parse(String(putCall?.[1]?.body))
      const clip = body.timeline.tracks[0].clips[0]
      expect(clip.timelineStart).toBe(1)
      expect(clip.duration).toBe(3)
      expect(clip.trimStart).toBe(1)
    })
  })

  it('applies layout presets to exact selected clips and clears transform keyframes', async () => {
    const layoutProject = {
      ...project,
      timeline: {
        version: 1 as const,
        tracks: [
          {
            id: 't1',
            kind: 'video' as const,
            label: 'V1',
            clips: [{
              id: 'same',
              timelineStart: 0,
              duration: 4,
              media: { type: 'upload' as const, fileId: 'f-a', url: 'https://x.test/a.mp4', mediaKind: 'video' as const },
              keyframes: [{ property: 'transform.x' as const, atSeconds: 1, value: 10 }],
            }],
          },
          {
            id: 't2',
            kind: 'video' as const,
            label: 'V2',
            clips: [{
              id: 'same',
              timelineStart: 0,
              duration: 4,
              media: { type: 'upload' as const, fileId: 'f-b', url: 'https://x.test/b.mp4', mediaKind: 'video' as const },
            }],
          },
          {
            id: 't3',
            kind: 'video' as const,
            label: 'V3',
            clips: [{
              id: 'same',
              timelineStart: 0,
              duration: 4,
              media: { type: 'upload' as const, fileId: 'f-c', url: 'https://x.test/c.mp4', mediaKind: 'video' as const },
            }],
          },
        ],
      },
    }
    ;(global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/video-editor/projects/proj-1') && (!init?.method || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { project: layoutProject } }) } as Response
      }
      if (url.includes('/api/v1/video-editor/render-jobs')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { jobs: [] } }) } as Response
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response
    })

    render(<VideoEditorShell projectId="proj-1" orgId="org-1" />)
    const clips = await screen.findAllByTestId('timeline-clip-same')
    fireEvent.click(clips[0])
    fireEvent.click(clips[1], { shiftKey: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Side by side' }))

    await waitFor(() => {
      const putCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
        String(url).includes('/api/v1/video-editor/projects/proj-1') && init?.method === 'PUT')
      expect(putCall).toBeTruthy()
      const body = JSON.parse(String(putCall?.[1]?.body))
      expect(body.timeline.tracks[0].clips[0].transform).toEqual({ x: -480, y: 0, scale: 0.5, rotation: 0, opacity: 1 })
      expect(body.timeline.tracks[0].clips[0].keyframes).toBeUndefined()
      expect(body.timeline.tracks[1].clips[0].transform).toEqual({ x: 480, y: 0, scale: 0.5, rotation: 0, opacity: 1 })
      expect(body.timeline.tracks[2].clips[0].transform).toBeUndefined()
    })
  })
})
