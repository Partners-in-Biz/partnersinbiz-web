import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('ignores stale portal request completions after the scoped org changes', async () => {
    let resolveRequest: (value: Response) => void = () => undefined
    const requestPromise = new Promise<Response>((resolve) => {
      resolveRequest = resolve
    })
    const veloxData = {
      ...portalData,
      data: {
        ...portalData.data,
        channels: [
          {
            id: 'channel-2',
            title: 'Velox Channel',
            status: 'active',
            youtubeHandle: '@velox',
          },
        ],
        videos: [],
      },
    }
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return requestPromise
      if (url.includes('velox-org')) return jsonResponse(veloxData)
      return jsonResponse(portalData)
    })
    global.fetch = fetchMock as jest.Mock

    const { rerender } = render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    expect(await screen.findAllByText('Lumen Channel')).not.toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'channel-1' } })
    fireEvent.change(screen.getByLabelText('Video title'), { target: { value: 'Lumen stale request' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled()
    })

    rerender(<YouTubeStudioPortalWorkspace orgId="velox-org" />)

    expect(await screen.findAllByText('Velox Channel')).not.toHaveLength(0)
    expect((screen.getByLabelText('Channel') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Video title') as HTMLInputElement).value).toBe('')

    await act(async () => {
      resolveRequest(jsonResponse({ success: true, data: { id: 'request-1' } }))
      await requestPromise
      await Promise.resolve()
    })

    expect(screen.queryByText('Video request sent to the PiB team.')).not.toBeInTheDocument()
    expect((screen.getByLabelText('Video title') as HTMLInputElement).value).toBe('')
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

  it('ignores out-of-order portal loads after the scoped org changes', async () => {
    let resolveLumenLoad: (value: Response) => void = () => undefined
    const lumenLoad = new Promise<Response>((resolve) => {
      resolveLumenLoad = resolve
    })
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('lumen-org')) return lumenLoad
      if (url.includes('blocked-org')) {
        return jsonResponse(
          {
            success: false,
            error: 'YouTube Studio module is disabled for this client portal',
            moduleDisabled: true,
            module: 'youtubeStudio',
          },
          false,
        )
      }
      return jsonResponse(portalData)
    })
    global.fetch = fetchMock as jest.Mock

    const { rerender } = render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('lumen-org'))
    })

    rerender(<YouTubeStudioPortalWorkspace orgId="blocked-org" />)

    expect(await screen.findByText('YouTube Studio is not enabled for this portal.')).toBeInTheDocument()

    await act(async () => {
      resolveLumenLoad(jsonResponse(portalData))
      await lumenLoad
      await Promise.resolve()
    })

    expect(screen.getByText('YouTube Studio is not enabled for this portal.')).toBeInTheDocument()
    expect(screen.queryByText('Lumen Channel')).not.toBeInTheDocument()
    expect(screen.queryByText('Draft launch cut')).not.toBeInTheDocument()
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

  it('ignores stale admin save completions after the scoped org changes', async () => {
    let resolveSave: (value: Response) => void = () => undefined
    const savePromise = new Promise<Response>((resolve) => {
      resolveSave = resolve
    })
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return savePromise
      if (url.includes('velox-org') && url.includes('/channels')) {
        return jsonResponse({
          success: true,
          data: {
            channels: [
              {
                id: 'channel-2',
                title: 'Velox Channel',
                status: 'active',
                youtubeHandle: '@velox',
              },
            ],
          },
        })
      }
      if (url.includes('/channels')) return jsonResponse({ success: true, data: { channels: [] } })
      if (url.includes('/series')) return jsonResponse({ success: true, data: { series: [] } })
      if (url.includes('/videos')) return jsonResponse({ success: true, data: { videos: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    const { rerender } = render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('lumen-org'))).toHaveLength(3)
    })

    const channelTitleField = await screen.findByLabelText('Channel title')
    fireEvent.change(channelTitleField, { target: { value: 'Lumen stale channel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save channel' }))

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Saving...' })).toHaveLength(2)
    })

    rerender(<YouTubeStudioAdminWorkspace orgId="velox-org" orgName="Velox" />)

    expect(await screen.findAllByText('Velox Channel')).not.toHaveLength(0)
    expect((screen.getByLabelText('Channel title') as HTMLInputElement).value).toBe('')

    await act(async () => {
      resolveSave(jsonResponse({ success: true, data: { id: 'channel-1' } }))
      await savePromise
      await Promise.resolve()
    })

    expect(screen.queryByText('YouTube channel workspace saved.')).not.toBeInTheDocument()
    expect((screen.getByLabelText('Channel title') as HTMLInputElement).value).toBe('')
  })

  it('ignores out-of-order admin loads after the scoped org changes', async () => {
    let resolveLumenChannels: (value: Response) => void = () => undefined
    let resolveLumenSeries: (value: Response) => void = () => undefined
    let resolveLumenVideos: (value: Response) => void = () => undefined
    const lumenChannels = new Promise<Response>((resolve) => {
      resolveLumenChannels = resolve
    })
    const lumenSeries = new Promise<Response>((resolve) => {
      resolveLumenSeries = resolve
    })
    const lumenVideos = new Promise<Response>((resolve) => {
      resolveLumenVideos = resolve
    })
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('lumen-org') && url.includes('/channels')) return lumenChannels
      if (url.includes('lumen-org') && url.includes('/series')) return lumenSeries
      if (url.includes('lumen-org') && url.includes('/videos')) return lumenVideos
      if (url.includes('velox-org') && url.includes('/channels')) {
        return jsonResponse({
          success: true,
          data: {
            channels: [
              {
                id: 'channel-2',
                title: 'Velox Channel',
                status: 'active',
                youtubeHandle: '@velox',
              },
            ],
          },
        })
      }
      if (url.includes('velox-org') && url.includes('/series')) return jsonResponse({ success: true, data: { series: [] } })
      if (url.includes('velox-org') && url.includes('/videos')) {
        return jsonResponse({
          success: true,
          data: {
            videos: [
              {
                id: 'video-2',
                title: 'Velox launch cut',
                status: 'production',
                objective: 'Produce the launch video',
                videoType: 'long_form',
              },
            ],
          },
        })
      }
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    const { rerender } = render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('lumen-org'))).toHaveLength(3)
    })

    rerender(<YouTubeStudioAdminWorkspace orgId="velox-org" orgName="Velox" />)

    expect(await screen.findAllByText('Velox Channel')).not.toHaveLength(0)
    expect(await screen.findByText('Velox launch cut')).toBeInTheDocument()

    await act(async () => {
      resolveLumenChannels(jsonResponse({
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
      }))
      resolveLumenSeries(jsonResponse({ success: true, data: { series: [] } }))
      resolveLumenVideos(jsonResponse({
        success: true,
        data: {
          videos: [
            {
              id: 'video-1',
              title: 'Lumen draft cut',
              status: 'production',
              objective: 'Old org video',
              videoType: 'long_form',
            },
          ],
        },
      }))
      await Promise.all([lumenChannels, lumenSeries, lumenVideos])
      await Promise.resolve()
    })

    expect(screen.getAllByText('Velox Channel')).not.toHaveLength(0)
    expect(screen.getByText('Velox launch cut')).toBeInTheDocument()
    expect(screen.queryByText('Lumen Channel')).not.toBeInTheDocument()
    expect(screen.queryByText('Lumen draft cut')).not.toBeInTheDocument()
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
