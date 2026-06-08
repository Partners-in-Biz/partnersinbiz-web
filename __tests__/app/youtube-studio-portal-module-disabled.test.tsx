import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    packets: [
      {
        id: 'packet-1',
        videoProjectId: 'video-1',
        versionNumber: 1,
        status: 'client_review',
        visibility: 'private',
        titleOptions: [{ text: 'Launch plan', selected: true }],
        description: 'Client-safe launch description',
        tags: ['growth', 'retention'],
        chapters: [{ startSeconds: 0, title: 'Intro' }],
        checks: {
          rights: { status: 'pass' },
          aiDisclosure: { status: 'warning' },
          madeForKids: { status: 'pass' },
          metadata: { status: 'pass' },
          thumbnail: { status: 'pass' },
          captions: { status: 'pass' },
          approval: { status: 'warning' },
          connectedAccount: { status: 'pass' },
        },
      },
    ],
    analytics: [],
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

  it('renders client-facing publishing packet summaries', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(portalData))

    render(<YouTubeStudioPortalWorkspace />)

    expect(await screen.findByText('Launch plan')).toBeInTheDocument()
    expect(screen.getByText('Client-safe launch description')).toBeInTheDocument()
    expect(screen.getByText('growth')).toBeInTheDocument()
    expect(screen.getByText('retention')).toBeInTheDocument()
    expect(screen.getByText('rights: pass')).toBeInTheDocument()
    expect(screen.getByText('connected account: pass')).toBeInTheDocument()
  })

  it('sends a portal publishing packet decision from the client workspace', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return jsonResponse({ success: true })
      return jsonResponse(portalData)
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioPortalWorkspace />)

    const approvePacketButton = await screen.findByRole('button', { name: 'Approve packet' })
    fireEvent.click(approvePacketButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/portal/youtube-studio',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    const packetDecisionCall = fetchMock.mock.calls.find(([, init]) => (
      init?.method === 'PUT' &&
      String(init.body).includes('"packetId":"packet-1"')
    ))
    expect(JSON.parse(String(packetDecisionCall?.[1]?.body))).toMatchObject({
      packetId: 'packet-1',
      decision: 'approved',
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
      if (url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [] } })
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

  it('posts a private draft publishing packet from the admin builder', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return jsonResponse({ success: true, data: { id: 'packet-new' } })
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
      if (url.includes('/videos')) {
        return jsonResponse({
          success: true,
          data: {
            videos: [
              {
                id: 'video-1',
                channelWorkspaceId: 'channel-1',
                title: 'Draft launch cut',
                status: 'production',
                objective: 'Prepare launch',
                videoType: 'long_form',
              },
            ],
          },
        })
      }
      if (url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [] } })
      if (url.includes('/agent-jobs')) return jsonResponse({ success: true, data: { jobs: [] } })
      if (url.includes('/analytics')) return jsonResponse({ success: true, data: { snapshots: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    expect(await screen.findAllByText('Draft launch cut')).not.toHaveLength(0)
    const createPacketButton = screen.getByRole('button', { name: 'Create private packet' })
    const packetForm = within(createPacketButton.closest('form') as HTMLElement)

    fireEvent.change(packetForm.getByLabelText('Video'), { target: { value: 'video-1' } })
    fireEvent.change(packetForm.getByLabelText('Primary title'), { target: { value: 'Launch plan' } })
    fireEvent.change(packetForm.getByLabelText('Description'), { target: { value: 'Client-safe launch description' } })
    fireEvent.change(packetForm.getByLabelText('Tags'), { target: { value: 'growth, ops' } })
    fireEvent.change(packetForm.getByLabelText('Chapters'), { target: { value: '01:05 Deep dive' } })
    fireEvent.click(packetForm.getByLabelText('Self-declared made for kids'))
    fireEvent.click(packetForm.getByLabelText('Contains altered or synthetic media'))
    fireEvent.change(packetForm.getByLabelText('AI disclosure notes'), { target: { value: 'Synthetic b-roll disclosed.' } })
    fireEvent.click(createPacketButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/youtube-studio/publish-packets',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const postCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/v1/youtube-studio/publish-packets' &&
      init?.method === 'POST'
    ))
    const payload = JSON.parse(String(postCall?.[1]?.body))
    expect(payload).toMatchObject({
      orgId: 'lumen-org',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      titleOptions: [{ text: 'Launch plan', selected: true }],
      description: 'Client-safe launch description',
      tags: ['growth', 'ops'],
      chapters: [{ startSeconds: 65, title: 'Deep dive' }],
      selfDeclaredMadeForKids: true,
      containsSyntheticMedia: true,
      aiDisclosureNotes: 'Synthetic b-roll disclosed.',
    })
  })

  it('sends an admin publishing packet to portal review', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') return jsonResponse({ success: true, data: { id: 'packet-1' } })
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
      if (url.includes('/videos')) {
        return jsonResponse({
          success: true,
          data: {
            videos: [
              {
                id: 'video-1',
                channelWorkspaceId: 'channel-1',
                title: 'Draft launch cut',
                status: 'production',
                objective: 'Prepare launch',
                videoType: 'long_form',
              },
            ],
          },
        })
      }
      if (url.includes('/publish-packets')) {
        return jsonResponse({
          success: true,
          data: {
            packets: [
              {
                id: 'packet-1',
                channelWorkspaceId: 'channel-1',
                videoProjectId: 'video-1',
                versionNumber: 1,
                status: 'draft',
                visibility: 'private',
                titleOptions: [{ text: 'Launch plan', selected: true }],
                description: 'Client-safe launch description',
                tags: ['growth'],
                chapters: [],
                checks: {
                  rights: { status: 'pass' },
                  approval: { status: 'warning' },
                },
              },
            ],
          },
        })
      }
      if (url.includes('/agent-jobs')) return jsonResponse({ success: true, data: { jobs: [] } })
      if (url.includes('/analytics')) return jsonResponse({ success: true, data: { snapshots: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    const sendButton = await screen.findByRole('button', { name: 'Send to portal' })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/youtube-studio/publish-packets',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    const putCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/v1/youtube-studio/publish-packets' &&
      init?.method === 'PUT'
    ))
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      id: 'packet-1',
      status: 'client_review',
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
      if (url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    const { rerender } = render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('lumen-org'))).toHaveLength(6)
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
      if (url.includes('lumen-org') && url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [] } })
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
      if (url.includes('velox-org') && url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [] } })
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
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('lumen-org'))).toHaveLength(6)
    })

    rerender(<YouTubeStudioAdminWorkspace orgId="velox-org" orgName="Velox" />)

    expect(await screen.findAllByText('Velox Channel')).not.toHaveLength(0)
    expect(await screen.findAllByText('Velox launch cut')).not.toHaveLength(0)

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
    expect(screen.getAllByText('Velox launch cut')).not.toHaveLength(0)
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
