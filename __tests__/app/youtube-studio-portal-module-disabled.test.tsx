import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { YouTubeStudioAdminWorkspace } from '@/components/youtube-studio/YouTubeStudioAdminWorkspace'
import { YouTubeStudioPortalWorkspace } from '@/components/youtube-studio/YouTubeStudioPortalWorkspace'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response
}

const portalData = {
  success: true,
  data: {
    channels: [
      {
        id: 'channel-1',
        title: 'Lumen Channel',
        status: 'active',
        youtubeHandle: '@lumen',
      },
    ],
    series: [],
    videos: [
      {
        id: 'video-1',
        title: 'Draft launch cut',
        status: 'client_review',
        objective: 'Review this draft',
        videoType: 'long_form',
        clientReview: { status: 'requested' },
      },
    ],
    packets: [],
  },
}

describe('YouTubeStudioPortalWorkspace module availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: 'YouTube Studio module is disabled for this client portal',
        moduleDisabled: true,
        module: 'youtubeStudio',
      }),
    } as Response)
  })

  it('shows a disabled-module message instead of an empty request list', async () => {
    render(<YouTubeStudioPortalWorkspace />)

    await waitFor(() => {
      expect(screen.getByText('YouTube Studio is not enabled for this portal.')).toBeInTheDocument()
    })
    expect(screen.queryByText('No YouTube videos yet')).not.toBeInTheDocument()
  })

  it('uses the scoped portal org id for load, request, and review API calls', async () => {
    const orgId = 'lumen org/1'
    const scopedPath = `/api/v1/portal/youtube-studio?${new URLSearchParams({ orgId }).toString()}`
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ success: true, data: { id: 'request-1' } })
      if (init?.method === 'PUT') return jsonResponse({ success: true })
      return jsonResponse(portalData)
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioPortalWorkspace orgId={orgId} />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(scopedPath)
    })

    fireEvent.change(await screen.findByLabelText('Channel'), { target: { value: 'channel-1' } })
    fireEvent.change(screen.getByLabelText('Video title'), { target: { value: 'New launch video' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        scopedPath,
        expect.objectContaining({ method: 'POST' }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        scopedPath,
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  it('clears stale load notices after successful scoped portal reloads', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('blocked-org')) {
        return jsonResponse({ success: false, error: 'Portal load is blocked' }, false)
      }
      return jsonResponse(portalData)
    })
    global.fetch = fetchMock as jest.Mock

    const { rerender } = render(<YouTubeStudioPortalWorkspace orgId="blocked-org" />)

    expect(await screen.findByText('Portal load is blocked')).toBeInTheDocument()

    rerender(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    expect(await screen.findAllByText('Lumen Channel')).not.toHaveLength(0)
    await waitFor(() => {
      expect(screen.queryByText('Portal load is blocked')).not.toBeInTheDocument()
    })
  })

  it('clears stale load notices after successful scoped admin reloads', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blocked-org')) return jsonResponse({ success: false }, false)
      if (url.includes('/channels')) {
        return jsonResponse({
          success: true,
          data: {
            channels: [
              {
                id: 'channel-1',
                title: 'Lumen Channel',
                status: 'active',
                youtubeHandle: '@lumen',
              },
            ],
          },
        })
      }
      if (url.includes('/series')) return jsonResponse({ success: true, data: { series: [] } })
      if (url.includes('/videos')) return jsonResponse({ success: true, data: { videos: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    const { rerender } = render(<YouTubeStudioAdminWorkspace orgId="blocked-org" orgName="Blocked" />)

    expect(await screen.findByText('Could not load the full YouTube Studio workspace.')).toBeInTheDocument()

    rerender(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    expect(await screen.findAllByText('Lumen Channel')).not.toHaveLength(0)
    await waitFor(() => {
      expect(screen.queryByText('Could not load the full YouTube Studio workspace.')).not.toBeInTheDocument()
    })
  })

  it('disables portal review actions while a decision is in flight', async () => {
    let resolveReview: (value: Response) => void = () => undefined
    const reviewPromise = new Promise<Response>((resolve) => {
      resolveReview = resolve
    })
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return reviewPromise
      return jsonResponse(portalData)
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioPortalWorkspace />)

    const approveButton = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approveButton)

    await waitFor(() => {
      expect(approveButton).toBeDisabled()
    })
    fireEvent.click(approveButton)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)

    resolveReview(jsonResponse({ success: true }))
    await waitFor(() => {
      expect(approveButton).not.toBeDisabled()
    })
  })
})
