import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MediaLibraryPanel } from '@/components/video-editor/MediaLibraryPanel'
import { VideoEditorShell } from '@/components/video-editor/VideoEditorShell'
import { defaultVideoEditorSettings } from '@/lib/video-editor/types'
import type { EditorTimeline } from '@/lib/video-editor/types'

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body } as Response
}

const emptyTimeline: EditorTimeline = {
  version: 1,
  tracks: [
    { id: 'text-1', kind: 'text', label: 'Text', clips: [] },
    { id: 'video-1', kind: 'video', label: 'Video', clips: [] },
    { id: 'audio-1', kind: 'audio', label: 'Audio', clips: [] },
  ],
}

describe('MediaLibraryPanel video editor happy path', () => {
  it('shows readable nested source cards and explains disabled cards', () => {
    const onAddClip = jest.fn()
    render(
      <MediaLibraryPanel
        orgId="org-1"
        onRefresh={jest.fn()}
        onAddClip={onAddClip}
        sources={[
          {
            id: 'youtube_asset:asset-1',
            title: 'Founder raw footage',
            description: 'YouTube asset / video',
            source: {
              kind: 'youtube_asset',
              refId: 'asset-1',
              url: 'https://cdn.example.com/founder.mp4',
              mimeType: 'video/mp4',
            },
          },
          {
            id: 'youtube_asset:asset-2',
            title: 'Processing interview',
            source: { kind: 'youtube_asset', refId: 'asset-2', storagePath: 'gs://private/raw.mp4' },
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Founder raw footage/ }))

    expect(onAddClip).toHaveBeenCalledWith(expect.objectContaining({
      duration: 5,
      media: expect.objectContaining({
        sourceAssetId: 'asset-1',
        type: 'youtube_source_asset',
        url: 'https://cdn.example.com/founder.mp4',
        mediaKind: 'video',
      }),
    }))
    expect(screen.getByRole('button', { name: /Processing interview/ })).toBeDisabled()
    expect(screen.getByText(/No client-readable URL is available yet/)).toBeInTheDocument()
  })

  it('surfaces upload progress and inserts the returned source immediately', async () => {
    const onSourceUploaded = jest.fn()
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: {
        source: {
          id: 'upload:upload-1',
          title: 'product.png',
          source: {
            kind: 'upload',
            refId: 'upload-1',
            url: 'https://cdn.example.com/product.png',
            mimeType: 'image/png',
          },
        },
      },
    }, true, 201)) as jest.Mock

    render(
      <MediaLibraryPanel
        orgId="org-1"
        sources={[]}
        onRefresh={jest.fn()}
        onAddClip={jest.fn()}
        onSourceUploaded={onSourceUploaded}
      />,
    )

    fireEvent.change(screen.getByLabelText(/Upload media/), {
      target: { files: [new File(['image'], 'product.png', { type: 'image/png' })] },
    })

    expect(await screen.findByText(/Uploading product\.png/)).toBeInTheDocument()
    await waitFor(() => expect(onSourceUploaded).toHaveBeenCalledWith(expect.objectContaining({ title: 'product.png' })))
    expect(await screen.findByText(/Uploaded product\.png/)).toBeInTheDocument()
  })
})

describe('VideoEditorShell text title happy path', () => {
  it('creates a selected editable text clip and enables render once duration exists', async () => {
    const savedTimelines: EditorTimeline[] = []
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/video-editor/render-jobs')) {
        return jsonResponse({ success: true, data: { jobs: [] } })
      }
      if (url.includes('/api/v1/creative-canvas/sources')) {
        return jsonResponse({ success: true, data: { sources: [] } })
      }
      if (url.includes('/api/v1/video-editor/projects/project-1') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        savedTimelines.push(body.timeline)
        return jsonResponse({ success: true, data: { project: { ...project, timeline: body.timeline } } })
      }
      if (url.includes('/api/v1/video-editor/projects/project-1')) {
        return jsonResponse({ success: true, data: { project } })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as jest.Mock

    const project = {
      id: 'project-1',
      orgId: 'org-1',
      title: 'Proof cut',
      settings: defaultVideoEditorSettings(),
      timeline: emptyTimeline,
      status: 'draft' as const,
      deleted: false,
    }

    render(<VideoEditorShell projectId="project-1" orgId="org-1" />)

    await screen.findByRole('heading', { name: 'Proof cut' })
    expect(screen.getByRole('button', { name: 'Render MP4' })).toBeDisabled()
    expect(screen.getByText(/Add at least one media clip or text title clip/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Add to timeline'), { target: { value: 'text' } })

    expect(await screen.findByText(/Text title added/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Title text')).toBeInTheDocument()
    await waitFor(() => expect(savedTimelines).toHaveLength(1))

    const textTrack = savedTimelines[0].tracks.find((track) => track.kind === 'text')
    expect(textTrack?.clips[0]).toMatchObject({
      duration: 5,
      text: expect.objectContaining({ content: 'Title text' }),
    })
    expect(screen.getByRole('button', { name: 'Render MP4' })).not.toBeDisabled()
  })
})
