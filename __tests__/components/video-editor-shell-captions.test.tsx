/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('@/components/video-editor/PreviewPlayer', () => ({ PreviewPlayer: () => <div data-testid="preview" /> }))
jest.mock('@/components/video-editor/TimelinePanel', () => ({ TimelinePanel: () => <div data-testid="timeline" /> }))
jest.mock('@/components/video-editor/MediaLibraryPanel', () => ({ MediaLibraryPanel: () => <div data-testid="media" /> }))

import { VideoEditorShell } from '@/components/video-editor/VideoEditorShell'

const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/video-editor/tts/voices')) {
    return new Response(
      JSON.stringify({ success: true, data: { voices: [{ id: 'alloy', label: 'Alloy', provider: 'gateway' }] } }),
      { status: 200 },
    )
  }
  if (url.includes('/video-editor/transcripts')) {
    return new Response(JSON.stringify({ success: true, data: { transcripts: [] } }), { status: 200 })
  }
  if (url.includes('/video-editor/render-jobs')) {
    return new Response(JSON.stringify({ success: true, data: { jobs: [] } }), { status: 200 })
  }
  if (url.includes('/creative-canvas/sources')) {
    return new Response(JSON.stringify({ success: true, data: { sources: [] } }), { status: 200 })
  }
  if (url.includes('/video-editor/projects/')) {
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          project: {
            id: 'p-1',
            orgId: 'o-1',
            title: 'T',
            settings: { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000000' },
            timeline: { version: 1, tracks: [] },
            status: 'draft',
          },
        },
      }),
      { status: 200 },
    )
  }
  return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
})

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockClear()
})

describe('VideoEditorShell caption tabs', () => {
  it('renders Inspector/Captions/Voiceover tabs and loads transcripts + voices', async () => {
    render(<VideoEditorShell projectId="p-1" orgId="o-1" />)
    await waitFor(() => expect(screen.getByRole('tab', { name: /captions/i })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: /inspector/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /voiceover/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /captions/i }))
    await waitFor(() => expect(screen.getByText(/no captions yet/i)).toBeInTheDocument())
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((u) => u.includes('/video-editor/transcripts'))).toBe(true)
    expect(urls.some((u) => u.includes('/video-editor/tts/voices'))).toBe(true)
  })
})
