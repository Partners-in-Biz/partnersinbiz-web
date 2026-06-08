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
    releasePlans: [
      {
        id: 'release-1',
        videoProjectId: 'video-1',
        publishingPacketId: 'packet-1',
        mode: 'scheduled_api_publish',
        status: 'scheduled',
        targetVisibility: 'public',
        scheduledPublishAt: '2026-06-20T10:00:00Z',
        publicSummary: 'Launch goes live next week.',
        checks: {
          approvedPacket: { status: 'pass' },
          connectedAccount: { status: 'pass' },
          privateFirst: { status: 'pass' },
          clientConfirmation: { status: 'not_applicable' },
          scheduleWindow: { status: 'pass' },
        },
      },
    ],
    sourceAssets: [
      {
        id: 'asset-1',
        videoProjectId: 'video-1',
        title: 'Launch interview raw footage',
        assetType: 'raw_footage',
        status: 'ready',
        durationSeconds: 960,
        mediaFormat: 'horizontal',
        sourceUrl: 'https://client.example/raw-interview',
        clientNotes: 'Client supplied launch interview footage.',
        rights: { status: 'needs_review', owner: 'Acme Team', license: 'Client supplied footage' },
      },
    ],
    clipCandidates: [
      {
        id: 'clip-1',
        sourceAssetId: 'asset-1',
        videoProjectId: 'video-1',
        title: 'Strong customer proof moment',
        summary: 'Client explains the measurable result.',
        startSeconds: 120,
        endSeconds: 178,
        targetFormat: 'vertical_short',
        status: 'suggested',
        hook: 'We cut reporting time in half.',
        transcriptExcerpt: 'We cut reporting time in half after the launch.',
        checks: {
          rights: { status: 'warning' },
          aiDisclosure: { status: 'warning' },
        },
      },
    ],
    productionDrafts: [
      {
        id: 'draft-1',
        videoProjectId: 'video-1',
        title: 'Launch story draft',
        draftType: 'script',
        status: 'client_review',
        versionNumber: 2,
        summary: 'Narrative arc for the launch story.',
        hook: 'Open with the before/after tension.',
        outline: ['Hook', 'Problem', 'Proof'],
        scriptText: 'Client-visible draft script excerpt.',
        scenes: [{
          label: 'Hook',
          summary: 'Founder opens with the measurable result.',
          targetSeconds: 45,
          voiceover: 'We cut reporting time in half.',
          visualNotes: 'Talking-head with product overlay.',
          onScreenText: 'Reporting time cut in half',
        }],
        checks: {
          claims: { status: 'warning' },
          brand: { status: 'pass' },
          sourceEvidence: { status: 'warning' },
          clientApproval: { status: 'warning' },
        },
        clientNotes: 'Client can review the flow and script.',
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
    expect(screen.getAllByText('connected account: pass').length).toBeGreaterThan(0)
  })

  it('renders client-facing release plan summaries', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(portalData))

    render(<YouTubeStudioPortalWorkspace />)

    expect(await screen.findByText('Launch goes live next week.')).toBeInTheDocument()
    expect(screen.getByText('scheduled api publish / scheduled / public')).toBeInTheDocument()
    expect(screen.getByText('scheduled for 2026-06-20T10:00:00Z')).toBeInTheDocument()
    expect(screen.getByText('approved packet: pass')).toBeInTheDocument()
    expect(screen.queryByText('secret-execution-job')).not.toBeInTheDocument()
  })

  it('renders client-facing source asset and clip candidate summaries', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(portalData))

    render(<YouTubeStudioPortalWorkspace />)

    expect(await screen.findByText('Launch interview raw footage')).toBeInTheDocument()
    expect(screen.getByText('raw footage / ready / 960s')).toBeInTheDocument()
    expect(screen.getByText('Client supplied launch interview footage.')).toBeInTheDocument()
    expect(screen.getByText('rights: needs review')).toBeInTheDocument()
    expect(screen.getByText('Strong customer proof moment')).toBeInTheDocument()
    expect(screen.getByText('120s-178s / vertical short / suggested')).toBeInTheDocument()
    expect(screen.getByText('Client explains the measurable result.')).toBeInTheDocument()
    expect(screen.getByText('We cut reporting time in half after the launch.')).toBeInTheDocument()
    expect(screen.queryByText('Operator-only')).not.toBeInTheDocument()
  })

  it('renders client-facing production draft summaries', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(portalData))

    render(<YouTubeStudioPortalWorkspace />)

    expect(await screen.findByText('Launch story draft')).toBeInTheDocument()
    expect(screen.getByText('script / client review / v2')).toBeInTheDocument()
    expect(screen.getByText('Narrative arc for the launch story.')).toBeInTheDocument()
    expect(screen.getByText('Open with the before/after tension.')).toBeInTheDocument()
    expect(screen.getByText('Client-visible draft script excerpt.')).toBeInTheDocument()
    expect(screen.getByText('Hook / 45s')).toBeInTheDocument()
    expect(screen.getByText('Founder opens with the measurable result.')).toBeInTheDocument()
    expect(screen.getByText('claims: warning')).toBeInTheDocument()
    expect(screen.queryByText('Operator-only')).not.toBeInTheDocument()
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

  it('sends a portal production draft decision from the client workspace', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return jsonResponse({ success: true })
      return jsonResponse(portalData)
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioPortalWorkspace />)

    const approveDraftButton = await screen.findByRole('button', { name: 'Approve draft' })
    fireEvent.click(approveDraftButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/portal/youtube-studio',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    const draftDecisionCall = fetchMock.mock.calls.find(([, init]) => (
      init?.method === 'PUT' &&
      String(init.body).includes('"productionDraftId":"draft-1"')
    ))
    expect(JSON.parse(String(draftDecisionCall?.[1]?.body))).toMatchObject({
      productionDraftId: 'draft-1',
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
      if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
      if (url.includes('/production-drafts')) return jsonResponse({ success: true, data: { productionDrafts: [] } })
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
      if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
      if (url.includes('/agent-jobs')) return jsonResponse({ success: true, data: { jobs: [] } })
      if (url.includes('/production-drafts')) return jsonResponse({ success: true, data: { productionDrafts: [] } })
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
      if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
      if (url.includes('/production-drafts')) return jsonResponse({ success: true, data: { productionDrafts: [] } })
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

  it('posts a scheduled release plan from the admin workspace', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/youtube-studio/release-plans' && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'release-1' } })
      }
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
                status: 'publish_ready',
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
                status: 'approved',
                visibility: 'private',
                titleOptions: [{ text: 'Launch plan', selected: true }],
                tags: ['growth'],
                chapters: [],
                checks: {
                  approval: { status: 'pass' },
                  connectedAccount: { status: 'pass' },
                },
              },
            ],
          },
        })
      }
      if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
      if (url.includes('/production-drafts')) return jsonResponse({ success: true, data: { productionDrafts: [] } })
      if (url.includes('/agent-jobs')) return jsonResponse({ success: true, data: { jobs: [] } })
      if (url.includes('/analytics')) return jsonResponse({ success: true, data: { snapshots: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    const createReleaseButton = await screen.findByRole('button', { name: 'Create release plan' })
    const releaseForm = within(createReleaseButton.closest('form') as HTMLElement)

    fireEvent.change(releaseForm.getByLabelText('Approved packet'), { target: { value: 'packet-1' } })
    fireEvent.change(releaseForm.getByLabelText('Release mode'), { target: { value: 'scheduled_api_publish' } })
    fireEvent.change(releaseForm.getByLabelText('Target visibility'), { target: { value: 'public' } })
    fireEvent.change(releaseForm.getByLabelText('Scheduled publish time'), { target: { value: '2026-06-20T10:00:00Z' } })
    fireEvent.change(releaseForm.getByLabelText('Public summary'), { target: { value: 'Launch goes live next week.' } })
    fireEvent.click(createReleaseButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/youtube-studio/release-plans',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const postCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/v1/youtube-studio/release-plans' &&
      init?.method === 'POST'
    ))
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      orgId: 'lumen-org',
      publishingPacketId: 'packet-1',
      mode: 'scheduled_api_publish',
      targetVisibility: 'public',
      scheduledPublishAt: '2026-06-20T10:00:00Z',
      publicSummary: 'Launch goes live next week.',
    })
  })

  it('posts source assets and clip candidates from the admin workspace', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/youtube-studio/source-assets' && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'asset-new' } })
      }
      if (url === '/api/v1/youtube-studio/clip-candidates' && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'clip-new' } })
      }
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
      if (url.includes('/source-assets')) {
        return jsonResponse({
          success: true,
          data: {
            sourceAssets: [
              {
                id: 'asset-1',
                channelWorkspaceId: 'channel-1',
                videoProjectId: 'video-1',
                title: 'Launch interview raw footage',
                assetType: 'raw_footage',
                status: 'ready',
                durationSeconds: 960,
              },
            ],
          },
        })
      }
      if (url.includes('/clip-candidates')) return jsonResponse({ success: true, data: { clipCandidates: [] } })
      if (url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [] } })
      if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
      if (url.includes('/agent-jobs')) return jsonResponse({ success: true, data: { jobs: [] } })
      if (url.includes('/production-drafts')) return jsonResponse({ success: true, data: { productionDrafts: [] } })
      if (url.includes('/analytics')) return jsonResponse({ success: true, data: { snapshots: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    const addAssetButton = await screen.findByRole('button', { name: 'Add source asset' })
    const assetForm = within(addAssetButton.closest('form') as HTMLElement)

    fireEvent.change(assetForm.getByLabelText('Asset channel'), { target: { value: 'channel-1' } })
    fireEvent.change(assetForm.getByLabelText('Asset video'), { target: { value: 'video-1' } })
    fireEvent.change(assetForm.getByLabelText('Asset title'), { target: { value: 'Launch interview raw footage' } })
    fireEvent.change(assetForm.getByLabelText('Asset type'), { target: { value: 'raw_footage' } })
    fireEvent.change(assetForm.getByLabelText('Asset URL'), { target: { value: 'https://client.example/raw-interview' } })
    fireEvent.change(assetForm.getByLabelText('Duration seconds'), { target: { value: '960' } })
    fireEvent.change(assetForm.getByLabelText('Client asset notes'), { target: { value: 'Client supplied launch interview footage.' } })
    fireEvent.click(assetForm.getByLabelText('Show asset in portal'))
    fireEvent.click(addAssetButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/youtube-studio/source-assets',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const assetPost = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/v1/youtube-studio/source-assets' &&
      init?.method === 'POST'
    ))
    expect(JSON.parse(String(assetPost?.[1]?.body))).toMatchObject({
      orgId: 'lumen-org',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      title: 'Launch interview raw footage',
      assetType: 'raw_footage',
      sourceUrl: 'https://client.example/raw-interview',
      durationSeconds: 960,
      clientNotes: 'Client supplied launch interview footage.',
      visibility: { showInClientPortal: true },
    })

    const createClipButton = await screen.findByRole('button', { name: 'Create clip candidate' })
    const clipForm = within(createClipButton.closest('form') as HTMLElement)

    fireEvent.change(clipForm.getByLabelText('Clip source asset'), { target: { value: 'asset-1' } })
    fireEvent.change(clipForm.getByLabelText('Clip video'), { target: { value: 'video-1' } })
    fireEvent.change(clipForm.getByLabelText('Clip title'), { target: { value: 'Strong customer proof moment' } })
    fireEvent.change(clipForm.getByLabelText('Start'), { target: { value: '02:00' } })
    fireEvent.change(clipForm.getByLabelText('End'), { target: { value: '02:58' } })
    fireEvent.change(clipForm.getByLabelText('Target format'), { target: { value: 'vertical_short' } })
    fireEvent.change(clipForm.getByLabelText('Clip summary'), { target: { value: 'Client explains the measurable result.' } })
    fireEvent.change(clipForm.getByLabelText('Clip hook'), { target: { value: 'We cut reporting time in half.' } })
    fireEvent.change(clipForm.getByLabelText('Clip transcript excerpt'), { target: { value: 'We cut reporting time in half after the launch.' } })
    fireEvent.click(clipForm.getByLabelText('Show clip in portal'))
    fireEvent.click(createClipButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/youtube-studio/clip-candidates',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const clipPost = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/v1/youtube-studio/clip-candidates' &&
      init?.method === 'POST'
    ))
    expect(JSON.parse(String(clipPost?.[1]?.body))).toMatchObject({
      orgId: 'lumen-org',
      sourceAssetId: 'asset-1',
      videoProjectId: 'video-1',
      title: 'Strong customer proof moment',
      startSeconds: 120,
      endSeconds: 178,
      targetFormat: 'vertical_short',
      summary: 'Client explains the measurable result.',
      hook: 'We cut reporting time in half.',
      transcriptExcerpt: 'We cut reporting time in half after the launch.',
      visibility: { showInClientPortal: true },
    })
  })

  it('posts production drafts from the admin workspace', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/youtube-studio/production-drafts' && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'draft-new' } })
      }
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
      if (url.includes('/source-assets')) {
        return jsonResponse({
          success: true,
          data: {
            sourceAssets: [
              {
                id: 'asset-1',
                channelWorkspaceId: 'channel-1',
                videoProjectId: 'video-1',
                title: 'Launch interview raw footage',
                assetType: 'raw_footage',
                status: 'ready',
              },
            ],
          },
        })
      }
      if (url.includes('/clip-candidates')) {
        return jsonResponse({
          success: true,
          data: {
            clipCandidates: [
              {
                id: 'clip-1',
                sourceAssetId: 'asset-1',
                videoProjectId: 'video-1',
                title: 'Strong customer proof moment',
                startSeconds: 120,
                endSeconds: 178,
                targetFormat: 'vertical_short',
                status: 'suggested',
              },
            ],
          },
        })
      }
      if (url.includes('/production-drafts')) return jsonResponse({ success: true, data: { productionDrafts: [] } })
      if (url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [] } })
      if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
      if (url.includes('/agent-jobs')) return jsonResponse({ success: true, data: { jobs: [] } })
      if (url.includes('/analytics')) return jsonResponse({ success: true, data: { snapshots: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    const createDraftButton = await screen.findByRole('button', { name: 'Create production draft' })
    const draftForm = within(createDraftButton.closest('form') as HTMLElement)

    fireEvent.change(draftForm.getByLabelText('Draft video'), { target: { value: 'video-1' } })
    fireEvent.change(draftForm.getByLabelText('Draft title'), { target: { value: 'Launch story draft' } })
    fireEvent.change(draftForm.getByLabelText('Draft type'), { target: { value: 'script' } })
    fireEvent.change(draftForm.getByLabelText('Draft summary'), { target: { value: 'Narrative arc for the launch story.' } })
    fireEvent.change(draftForm.getByLabelText('Draft hook'), { target: { value: 'Open with the before/after tension.' } })
    fireEvent.change(draftForm.getByLabelText('Draft outline'), { target: { value: 'Hook\nProblem\nProof' } })
    fireEvent.change(draftForm.getByLabelText('Draft script'), { target: { value: 'Client-visible draft script excerpt.' } })
    fireEvent.change(draftForm.getByLabelText('Draft source assets'), { target: { value: 'asset-1' } })
    fireEvent.change(draftForm.getByLabelText('Draft clip candidates'), { target: { value: 'clip-1' } })
    fireEvent.change(draftForm.getByLabelText('Draft scenes'), {
      target: {
        value: 'Hook | 45 | Founder opens with the measurable result. | We cut reporting time in half. | Talking-head with product overlay. | Reporting time cut in half',
      },
    })
    fireEvent.click(draftForm.getByLabelText('Show draft in portal'))
    fireEvent.click(draftForm.getByLabelText('Show script in portal'))
    fireEvent.click(draftForm.getByLabelText('Show scenes in portal'))
    fireEvent.click(createDraftButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/youtube-studio/production-drafts',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const draftPost = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/v1/youtube-studio/production-drafts' &&
      init?.method === 'POST'
    ))
    expect(JSON.parse(String(draftPost?.[1]?.body))).toMatchObject({
      orgId: 'lumen-org',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      title: 'Launch story draft',
      draftType: 'script',
      summary: 'Narrative arc for the launch story.',
      hook: 'Open with the before/after tension.',
      outline: ['Hook', 'Problem', 'Proof'],
      scriptText: 'Client-visible draft script excerpt.',
      sourceAssetIds: ['asset-1'],
      clipCandidateIds: ['clip-1'],
      scenes: [{
        label: 'Hook',
        targetSeconds: 45,
        summary: 'Founder opens with the measurable result.',
        voiceover: 'We cut reporting time in half.',
        visualNotes: 'Talking-head with product overlay.',
        onScreenText: 'Reporting time cut in half',
      }],
      visibility: { showInClientPortal: true, showScriptInPortal: true, showScenesInPortal: true },
    })
  })

  it('sends an admin production draft to portal review', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/youtube-studio/production-drafts' && init?.method === 'PUT') {
        return jsonResponse({ success: true, data: { id: 'draft-1' } })
      }
      if (url.includes('/channels')) {
        return jsonResponse({
          success: true,
          data: {
            channels: [{ id: 'channel-1', title: 'Lumen Channel', status: 'active', youtubeHandle: '@lumen' }],
          },
        })
      }
      if (url.includes('/series')) return jsonResponse({ success: true, data: { series: [] } })
      if (url.includes('/videos')) {
        return jsonResponse({
          success: true,
          data: {
            videos: [{
              id: 'video-1',
              channelWorkspaceId: 'channel-1',
              title: 'Draft launch cut',
              status: 'production',
              objective: 'Prepare launch',
              videoType: 'long_form',
            }],
          },
        })
      }
      if (url.includes('/production-drafts')) {
        return jsonResponse({
          success: true,
          data: {
            productionDrafts: [{
              id: 'draft-1',
              channelWorkspaceId: 'channel-1',
              videoProjectId: 'video-1',
              title: 'Launch story draft',
              draftType: 'script',
              status: 'draft',
              versionNumber: 1,
              outline: ['Hook', 'Proof'],
              scenes: [],
              checks: {
                claims: { status: 'pass' },
                brand: { status: 'pass' },
                sourceEvidence: { status: 'warning' },
                clientApproval: { status: 'warning' },
              },
            }],
          },
        })
      }
      if (url.includes('/source-assets')) return jsonResponse({ success: true, data: { sourceAssets: [] } })
      if (url.includes('/clip-candidates')) return jsonResponse({ success: true, data: { clipCandidates: [] } })
      if (url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [] } })
      if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
      if (url.includes('/agent-jobs')) return jsonResponse({ success: true, data: { jobs: [] } })
      if (url.includes('/analytics')) return jsonResponse({ success: true, data: { snapshots: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    const sendDraftButton = await screen.findByRole('button', { name: 'Send draft to portal' })
    fireEvent.click(sendDraftButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/youtube-studio/production-drafts',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    const putCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/v1/youtube-studio/production-drafts' &&
      init?.method === 'PUT'
    ))
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      id: 'draft-1',
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
      if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
      if (url.includes('/production-drafts')) return jsonResponse({ success: true, data: { productionDrafts: [] } })
      return jsonResponse({ success: true })
    })
    global.fetch = fetchMock as jest.Mock

    const { rerender } = render(<YouTubeStudioAdminWorkspace orgId="lumen-org" orgName="Lumen" />)

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('lumen-org'))).toHaveLength(10)
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
      if (url.includes('lumen-org') && url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
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
      if (url.includes('velox-org') && url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [] } })
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
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('lumen-org'))).toHaveLength(10)
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
