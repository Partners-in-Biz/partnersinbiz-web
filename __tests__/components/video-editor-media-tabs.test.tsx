/** @jest-environment jsdom */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@/lib/portal/scoped-routing', () => ({
  scopedApiPath: (path: string, scope?: { orgId?: string }) => {
    if (!scope?.orgId) return path
    return `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(scope.orgId)}`
  },
}))

import { MediaLibraryPanel } from '@/components/video-editor/MediaLibraryPanel'

function baseProps(overrides: Partial<React.ComponentProps<typeof MediaLibraryPanel>> = {}) {
  return {
    orgId: 'org-1',
    projectId: 'project-1',
    canvasId: 'canvas-1',
    sources: [],
    onRefresh: jest.fn(),
    onAddClip: jest.fn(),
    ...overrides,
  }
}

describe('MediaLibraryPanel stock + generate tabs', () => {
  let runPollCount = 0

  beforeEach(() => {
    runPollCount = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/stock/search')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            results: [{
              id: 'pexels-photo-1',
              provider: 'pexels',
              mediaKind: 'image',
              title: 'Beach',
              thumbnailUrl: 'https://images.pexels.com/1-m.jpg',
              downloadUrl: 'https://images.pexels.com/1.jpg',
              attribution: 'Ann - Pexels',
            }],
          },
        }), { status: 200 })
      }
      if (url.includes('/stock/import') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          data: { upload: { fileId: 'f-1', url: 'https://storage.googleapis.com/f-1.jpg', mediaKind: 'image' } },
        }), { status: 200 })
      }
      if (url.includes('/stock/import-error') && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: false, error: 'Import failed on this card' }), { status: 500 })
      }
      if (url.includes('/creative-canvas/canvas-1/runs/generate') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          data: {
            pending: false,
            run: { id: 'run-1', canvasId: 'canvas-1', nodeId: 'node-1', status: 'completed' },
            node: { id: 'node-1-output', output: { url: 'https://storage.googleapis.com/generated.jpg', kind: 'image' } },
          },
        }), { status: 201 })
      }
      if (url.includes('/creative-canvas/canvas-async/runs/generate') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          data: {
            pending: true,
            run: { id: 'run-async', canvasId: 'canvas-async', nodeId: 'node-async', status: 'queued' },
          },
        }), { status: 201 })
      }
      if (url.includes('/creative-canvas/canvas-async/runs')) {
        runPollCount += 1
        return new Response(JSON.stringify({
          success: true,
          data: {
            runs: [{
              id: 'run-async',
              nodeId: 'node-async',
              status: runPollCount > 1 ? 'completed' : 'running',
              output: runPollCount > 1 ? { outputNodeId: 'node-async-output', url: 'https://storage.googleapis.com/generated-video.mp4' } : undefined,
            }],
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('searches stock and imports a result as an upload', async () => {
    const onAddClip = jest.fn()
    render(<MediaLibraryPanel {...baseProps({ onAddClip })} />)

    fireEvent.click(screen.getByRole('tab', { name: /stock/i }))
    fireEvent.change(screen.getByPlaceholderText(/search stock/i), { target: { value: 'beach' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() => expect(screen.getByText('Beach')).toBeInTheDocument())
    expect(screen.getByText('Ann - Pexels')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /add to project/i }))

    await waitFor(() => expect(onAddClip).toHaveBeenCalledWith(expect.objectContaining({
      media: expect.objectContaining({ type: 'upload', fileId: 'f-1', mediaKind: 'image' }),
    })))
  })

  it('shows stock import errors on the result card', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/stock/search')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            results: [{
              id: 'pexels-photo-err',
              provider: 'pexels',
              mediaKind: 'image',
              title: 'Broken beach',
              thumbnailUrl: 'https://images.pexels.com/err.jpg',
              downloadUrl: 'https://images.pexels.com/import-error.jpg',
              attribution: 'Ann - Pexels',
            }],
          },
        }), { status: 200 })
      }
      if (url.includes('/stock/import') && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: false, error: 'Import failed on this card' }), { status: 500 })
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    }) as unknown as typeof fetch
    render(<MediaLibraryPanel {...baseProps()} />)

    fireEvent.click(screen.getByRole('tab', { name: /stock/i }))
    fireEvent.change(screen.getByPlaceholderText(/search stock/i), { target: { value: 'beach' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await waitFor(() => expect(screen.getByText('Broken beach')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /add to project/i }))

    await waitFor(() => expect(screen.getByText('Import failed on this card')).toBeInTheDocument())
  })

  it('renders generate controls and inserts a completed canvas output', async () => {
    const onAddClip = jest.fn()
    render(<MediaLibraryPanel {...baseProps({ onAddClip })} />)

    fireEvent.click(screen.getByRole('tab', { name: /generate/i }))
    fireEvent.change(screen.getByPlaceholderText(/describe the b-roll/i), { target: { value: 'Slow beach b-roll' } })
    expect(screen.getByLabelText(/image or video/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }))

    await waitFor(() => expect(onAddClip).toHaveBeenCalledWith(expect.objectContaining({
      media: expect.objectContaining({
        type: 'canvas_output',
        canvasId: 'canvas-1',
        nodeId: 'node-1-output',
        runId: 'run-1',
        url: 'https://storage.googleapis.com/generated.jpg',
        mediaKind: 'image',
      }),
    })))
  })

  it('uses video duration and polls async generation output', async () => {
    jest.useFakeTimers()
    const onAddClip = jest.fn()
    render(<MediaLibraryPanel {...baseProps({ canvasId: 'canvas-async', onAddClip })} />)

    fireEvent.click(screen.getByRole('tab', { name: /generate/i }))
    fireEvent.change(screen.getByPlaceholderText(/describe the b-roll/i), { target: { value: 'Slow video b-roll' } })
    fireEvent.change(screen.getByLabelText(/image or video/i), { target: { value: 'video' } })
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/creative-canvas/canvas-async/runs/generate'),
      expect.objectContaining({
        body: expect.stringContaining('"duration":8'),
      }),
    ))
    await jest.advanceTimersByTimeAsync(6000)

    await waitFor(() => expect(onAddClip).toHaveBeenCalledWith(expect.objectContaining({
      media: expect.objectContaining({
        type: 'canvas_output',
        canvasId: 'canvas-async',
        nodeId: 'node-async-output',
        runId: 'run-async',
        url: 'https://storage.googleapis.com/generated-video.mp4',
        mediaKind: 'video',
      }),
    })))
  })
})
