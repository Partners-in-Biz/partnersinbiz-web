import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockReplace = jest.fn()
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()
let mockSearch = ''

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/portal/youtube-studio',
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: mockToastSuccess, error: mockToastError, toast: jest.fn() }),
}))

import { YouTubeStudioOAuthReturnHandler } from '@/components/youtube-studio/YouTubeStudioOAuthReturnHandler'
import { SendToYouTubeStudioButton } from '@/components/youtube-studio/SendToYouTubeStudioButton'
import { YouTubeChannelCard } from '@/components/youtube-studio/YouTubeStudioCards'
import { YouTubeStudioPipelineBoard } from '@/components/youtube-studio/YouTubeStudioPipelineBoard'
import { YouTubeStudioPortalWorkspace } from '@/components/youtube-studio/YouTubeStudioPortalWorkspace'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

const connectedChannel = {
  id: 'channel-1',
  orgId: 'org-1',
  title: 'Acme Films',
  youtubeHandle: '@acmefilms',
  status: 'active' as const,
  connectedAccountId: 'acct-1',
  publishingReadiness: { accountStatus: 'connected' as const },
  contentPillars: [],
  avoidTopics: [],
  aiDisclosureDefaults: { syntheticMediaLikely: false },
  defaultApprovalPolicy: {} as never,
  defaultPublishingPolicy: {} as never,
  deleted: false,
}

describe('YouTubeStudioOAuthReturnHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearch = ''
  })

  it('fires a success toast, strips OAuth params, and triggers a refresh', async () => {
    mockSearch = 'status=success&platform=youtube&account=acct-1&orgId=lumen-org'
    const onRefresh = jest.fn()

    render(<YouTubeStudioOAuthReturnHandler onRefresh={onRefresh} onProvisionFailed={jest.fn()} />)

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled())
    expect(mockToastSuccess.mock.calls[0][0]).toMatch(/channel linked/i)
    expect(onRefresh).toHaveBeenCalled()
    // orgId survives; OAuth params are stripped
    expect(mockReplace).toHaveBeenCalledWith('/portal/youtube-studio?orgId=lumen-org', { scroll: false })
  })

  it('fires an error toast and reports the accountId when provisioning failed', async () => {
    mockSearch = 'status=success&platform=youtube&account=acct-1&provision=failed'
    const onProvisionFailed = jest.fn()

    render(<YouTubeStudioOAuthReturnHandler onRefresh={jest.fn()} onProvisionFailed={onProvisionFailed} />)

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockToastError.mock.calls[0][0]).toMatch(/setup.*incomplete/i)
    expect(onProvisionFailed).toHaveBeenCalledWith('acct-1')
    expect(mockReplace).toHaveBeenCalledWith('/portal/youtube-studio', { scroll: false })
  })

  it('surfaces the provider error message on OAuth failure', async () => {
    mockSearch = 'status=error&message=Access%20denied'

    render(<YouTubeStudioOAuthReturnHandler onRefresh={jest.fn()} onProvisionFailed={jest.fn()} />)

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Access denied'))
  })

  it('does nothing when no status param is present', () => {
    mockSearch = 'orgId=lumen-org'

    render(<YouTubeStudioOAuthReturnHandler onRefresh={jest.fn()} onProvisionFailed={jest.fn()} />)

    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

describe('YouTubeChannelCard connection chip', () => {
  it('shows a connected chip', () => {
    render(<YouTubeChannelCard channel={connectedChannel} />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('shows a reauth chip for needs_reauth channels', () => {
    render(
      <YouTubeChannelCard
        channel={{ ...connectedChannel, publishingReadiness: { accountStatus: 'needs_reauth' as const } }}
      />,
    )
    expect(screen.getByText('Needs reconnect')).toBeInTheDocument()
  })

  it('shows a not-connected chip when there is no linked account', () => {
    render(
      <YouTubeChannelCard
        channel={{ ...connectedChannel, connectedAccountId: undefined, publishingReadiness: undefined }}
      />,
    )
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })
})

describe('portal workspace channel actions', () => {
  beforeEach(() => {
    mockSearch = ''
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: {
        channels: [
          connectedChannel,
          { ...connectedChannel, id: 'channel-2', title: 'Stale', publishingReadiness: { accountStatus: 'needs_reauth' } },
        ],
        orgId: 'lumen-org',
        series: [],
        videos: [],
        packets: [],
        releasePlans: [],
        sourceAssets: [],
        clipCandidates: [],
        productionDrafts: [],
        renderJobs: [],
        analytics: [],
      },
    })) as jest.Mock
  })

  it('offers "Link another channel" with prompt=select_account once a channel exists', async () => {
    render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    const link = await screen.findByRole('link', { name: 'Link another channel' })
    const href = link.getAttribute('href') ?? ''
    expect(href).toContain('/api/v1/social/oauth/youtube')
    expect(href).toContain('prompt=select_account')
    expect(href).toContain('feature=youtube_studio')
  })

  it('preserves the resolved portal org in OAuth links when the route has no orgId query', async () => {
    render(<YouTubeStudioPortalWorkspace />)

    await waitFor(() => {
      const href = screen.getByRole('link', { name: 'Link another channel' }).getAttribute('href') ?? ''
      expect(href).toContain('orgId=lumen-org')
      expect(href).toContain('redirectUrl=%2Fportal%2Fyoutube-studio%3ForgId%3Dlumen-org')
    })
  })

  it('offers Reconnect only on channels that need reauth', async () => {
    render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    await screen.findByRole('heading', { name: 'Stale' })
    expect(screen.getAllByRole('link', { name: 'Reconnect' })).toHaveLength(1)
  })

  it('creates YouTube Studio editor projects against the selected channel', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/portal/youtube-studio')) {
        return jsonResponse({
          success: true,
          data: {
            orgId: 'lumen-org',
            channels: [
              connectedChannel,
              { ...connectedChannel, id: 'channel-2', title: 'Capital Gains', youtubeHandle: '@capitalgains' },
            ],
            series: [],
            videos: [],
            packets: [],
            releasePlans: [],
            sourceAssets: [],
            clipCandidates: [],
            productionDrafts: [],
            renderJobs: [],
            analytics: [],
          },
        })
      }
      if (url.includes('/api/v1/video-editor/projects') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'edit-2' } })
      }
      if (url.includes('/api/v1/video-editor/projects')) {
        return jsonResponse({ success: true, data: { projects: [] } })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    fireEvent.change(await screen.findByLabelText('YouTube channel'), { target: { value: 'channel-2' } })
    fireEvent.change(screen.getByPlaceholderText('New edit title'), { target: { value: 'Short proof cut' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create edit' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/video-editor/projects', expect.objectContaining({ method: 'POST' }))
    })
    const createCall = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/api/v1/video-editor/projects') && init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      orgId: 'lumen-org',
      title: 'Short proof cut',
      channelWorkspaceId: 'channel-2',
    })
  })

  it('retries channel setup through the adopt endpoint after OAuth provisioning failed', async () => {
    mockSearch = 'status=success&platform=youtube&account=acct-retry&provision=failed'
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ success: true, data: { id: 'channel-retry' } })
      return jsonResponse({
        success: true,
        data: {
          channels: [],
          series: [],
          videos: [],
          packets: [],
          releasePlans: [],
          sourceAssets: [],
          clipCandidates: [],
          productionDrafts: [],
          renderJobs: [],
          analytics: [],
        },
      })
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Retry channel setup' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/youtube-studio/channels/adopt?orgId=lumen-org',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ accountId: 'acct-retry' }),
        }),
      )
    })
    expect(await screen.findByText('Channel setup completed.')).toBeInTheDocument()
  })
})

describe('studio empty state and guide', () => {
  it('shows the how-it-works panel with the Link CTA when no channels exist', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: {
        channels: [],
        series: [],
        videos: [],
        packets: [],
        releasePlans: [],
        sourceAssets: [],
        clipCandidates: [],
        productionDrafts: [],
        renderJobs: [],
        analytics: [],
      },
    })) as jest.Mock

    render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    expect(await screen.findByText('How YouTube Studio works')).toBeInTheDocument()
    expect(screen.getByText('Connect your channel')).toBeInTheDocument()
    expect(screen.getByText('Plan series & videos')).toBeInTheDocument()
    expect(screen.getByText('Produce the content')).toBeInTheDocument()
    expect(screen.getByText('Approve & publish')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Link YouTube channel' }).length).toBeGreaterThan(0)
  })

  it('hides the guide once a channel exists', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: {
        channels: [connectedChannel],
        series: [],
        videos: [],
        packets: [],
        releasePlans: [],
        sourceAssets: [],
        clipCandidates: [],
        productionDrafts: [],
        renderJobs: [],
        analytics: [],
      },
    })) as jest.Mock

    render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    await screen.findByRole('heading', { name: 'Acme Films' })
    expect(screen.queryByText('How YouTube Studio works')).not.toBeInTheDocument()
  })
})

const boardVideos = [
  { id: 'v1', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Idea video', videoType: 'long_form' as const, status: 'intake' as const, objective: '', source: { intakeType: 'manual' as const }, linked: {}, approvalPolicy: {} as never, deleted: false },
  { id: 'v2', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'In production', videoType: 'long_form' as const, status: 'production' as const, objective: '', source: { intakeType: 'manual' as const }, linked: {}, approvalPolicy: {} as never, deleted: false },
  { id: 'v3', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Needs review', videoType: 'long_form' as const, status: 'client_review' as const, objective: '', source: { intakeType: 'manual' as const }, linked: {}, approvalPolicy: {} as never, deleted: false },
  { id: 'v4', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Ready to ship', videoType: 'long_form' as const, status: 'publish_ready' as const, objective: '', source: { intakeType: 'manual' as const }, linked: {}, approvalPolicy: {} as never, deleted: false },
  { id: 'v5', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Already live', videoType: 'long_form' as const, status: 'live' as const, objective: '', source: { intakeType: 'manual' as const }, linked: {}, approvalPolicy: {} as never, deleted: false },
]

describe('YouTubeStudioPipelineBoard', () => {
  it('groups videos into the five pipeline columns', () => {
    render(<YouTubeStudioPipelineBoard videos={boardVideos} onReview={jest.fn()} onRepurpose={jest.fn()} />)

    expect(screen.getByText('Idea & scripting')).toBeInTheDocument()
    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByText('Client review')).toBeInTheDocument()
    expect(screen.getByText('Publish ready')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Idea video')).toBeInTheDocument()
    expect(screen.getByText('Already live')).toBeInTheDocument()
  })

  it('shows next-action buttons per column and forwards clicks', () => {
    const onReview = jest.fn()
    const onRepurpose = jest.fn()
    render(<YouTubeStudioPipelineBoard videos={boardVideos} onReview={onReview} onRepurpose={onRepurpose} />)

    screen.getByRole('button', { name: 'Review & approve' }).click()
    expect(onReview).toHaveBeenCalledWith('v3')

    screen.getByRole('button', { name: 'Repurpose to social' }).click()
    expect(onRepurpose).toHaveBeenCalledWith('v5')
  })

  it('renders an explanatory empty state per empty column', () => {
    render(<YouTubeStudioPipelineBoard videos={[]} onReview={jest.fn()} onRepurpose={jest.fn()} />)
    expect(screen.getAllByText(/Nothing here yet/).length).toBe(5)
  })
})

describe('SendToYouTubeStudioButton', () => {
  it('imports the video into the first connected channel on click', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/channels/links')) {
        return jsonResponse({
          success: true,
          data: {
            links: [
              {
                channelWorkspaceId: 'channel-1',
                accountId: 'acct-1',
                title: 'Acme Films',
                accountStatus: 'connected',
              },
            ],
          },
        })
      }
      if (url.includes('/videos/import') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { videoProjectId: 'video-new', sourceAssetId: 'asset-new' } })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as jest.Mock

    render(
      <SendToYouTubeStudioButton
        orgId="org-1"
        title="Launch reel"
        sourceUrl="https://cdn.example/launch.mp4"
        mediaFormat="vertical"
        origin={{ type: 'campaign', id: 'campaign-1' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /YouTube Studio/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/youtube-studio/videos/import'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const importCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/videos/import'))
    expect(JSON.parse(String(importCall?.[1]?.body))).toMatchObject({
      channelWorkspaceId: 'channel-1',
      title: 'Launch reel',
      sourceUrl: 'https://cdn.example/launch.mp4',
      mediaFormat: 'vertical',
      origin: { type: 'campaign', id: 'campaign-1' },
    })
    expect(await screen.findByText(/Sent to YouTube Studio/)).toBeInTheDocument()
  })

  it('explains when no channel is connected yet', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: { links: [] } })) as jest.Mock

    render(
      <SendToYouTubeStudioButton
        orgId="org-1"
        title="Launch reel"
        sourceUrl="https://cdn.example/launch.mp4"
        origin={{ type: 'social_post', id: 'post-1' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /YouTube Studio/ }))

    expect(await screen.findByText(/No YouTube channel connected/)).toBeInTheDocument()
  })
})
