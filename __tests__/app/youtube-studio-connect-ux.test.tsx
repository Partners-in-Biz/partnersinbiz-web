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
import { YouTubeChannelCard } from '@/components/youtube-studio/YouTubeStudioCards'
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

  it('offers Reconnect only on channels that need reauth', async () => {
    render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)

    await screen.findByRole('heading', { name: 'Stale' })
    expect(screen.getAllByRole('link', { name: 'Reconnect' })).toHaveLength(1)
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
