import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { YouTubeStudioAdminWorkspace } from '@/components/youtube-studio/YouTubeStudioAdminWorkspace'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response
}

function installYoutubeStudioFetch() {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/channels')) {
      return jsonResponse({ success: true, data: { channels: [
        {
          id: 'channel-1',
          title: 'Lumen Growth Channel',
          status: 'active',
          youtubeHandle: '@lumen',
          contentPillars: ['Proof-led growth', 'Operator walkthroughs'],
          audienceNotes: 'B2B founders and operations leads',
          publishingPolicy: {
            connectedAccountStatus: 'connected',
            apiProjectStatus: 'verified',
            publishingReadiness: 'scheduled_publish_ready',
            defaultVisibility: 'private',
            quotaDailyLimit: 10000,
            quotaUnitsRemaining: 8200,
            notes: 'Private-first uploads only until packet approval passes.',
          },
        },
        {
          id: 'channel-2',
          title: 'Velox Risk Channel',
          status: 'active',
          youtubeHandle: '@velox',
          publishingPolicy: {
            connectedAccountStatus: 'needs_reauth',
            apiProjectStatus: 'audit_required',
            publishingReadiness: 'blocked',
            defaultVisibility: 'private',
            quotaUnitsRemaining: 0,
            notes: 'OAuth reconnect is required before publishing.',
          },
        },
      ] } })
    }
    if (url.includes('/series')) return jsonResponse({ success: true, data: { series: [
      { id: 'series-1', channelWorkspaceId: 'channel-1', title: 'Launch Proof Series', status: 'active', cadence: 'weekly' },
    ] } })
    if (url.includes('/videos')) return jsonResponse({ success: true, data: { videos: [
      {
        id: 'video-1',
        channelWorkspaceId: 'channel-1',
        seriesId: 'series-1',
        title: 'Proof-led launch cockpit',
        status: 'production',
        objective: 'Show the operating system behind a launch.',
        videoType: 'long_form',
        brief: { summary: 'Turn the launch proof into an operator walkthrough.', targetAudience: 'Founders', keyMessage: 'Evidence beats noise.' },
        metadata: { workingTitle: 'Proof-led launch cockpit', tags: ['growth', 'proof'], description: 'Draft metadata.' },
        activity: [{ type: 'brief_created', summary: 'Brief accepted for production', at: '2026-06-09T10:00:00Z' }],
      },
      {
        id: 'video-2',
        channelWorkspaceId: 'channel-2',
        title: 'Blocked channel setup',
        status: 'blocked',
        objective: 'Cannot proceed until account reconnects.',
        videoType: 'short',
      },
    ] } })
    if (url.includes('/source-assets')) return jsonResponse({ success: true, data: { sourceAssets: [
      { id: 'asset-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Launch interview', assetType: 'raw_footage', status: 'ready', rights: { status: 'pass' } },
    ] } })
    if (url.includes('/clip-candidates')) return jsonResponse({ success: true, data: { clipCandidates: [
      { id: 'clip-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', sourceAssetId: 'asset-1', title: 'Strong hook', targetFormat: 'vertical_short', status: 'suggested', hook: 'Evidence beats noise.' },
    ] } })
    if (url.includes('/production-drafts')) return jsonResponse({ success: true, data: { productionDrafts: [
      { id: 'draft-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Operator walkthrough script', draftType: 'script', status: 'client_review', scriptText: 'Open on the proof ledger.', checks: { clientApproval: { status: 'warning' } } },
    ] } })
    if (url.includes('/render-jobs')) return jsonResponse({ success: true, data: { renderJobs: [
      { id: 'render-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', productionDraftId: 'draft-1', title: 'Full walkthrough render', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'qa_review', output: { previewUrl: 'https://cdn.example/preview.mp4' }, checks: { captions: { status: 'warning' } } },
    ] } })
    if (url.includes('/publish-packets')) return jsonResponse({ success: true, data: { packets: [
      { id: 'packet-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', versionNumber: 1, status: 'approved', visibility: 'private', titleOptions: [{ text: 'Proof-led launch cockpit', selected: true }], checks: { rights: { status: 'pass' }, approval: { status: 'pass' }, thumbnail: { status: 'warning' } } },
    ] } })
    if (url.includes('/release-plans')) return jsonResponse({ success: true, data: { releasePlans: [
      { id: 'release-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', publishingPacketId: 'packet-1', mode: 'scheduled_api_publish', status: 'scheduled', targetVisibility: 'public', scheduledPublishAt: '2026-06-20T10:00:00Z', publicSummary: 'Launch walkthrough ready.' },
    ] } })
    if (url.includes('/agent-jobs')) return jsonResponse({ success: true, data: { jobs: [
      { id: 'job-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Render metadata packet', skillKey: 'youtube-publish-readiness', status: 'running', inputSummary: 'Check packet gates.' },
    ] } })
    if (url.includes('/analytics')) return jsonResponse({ success: true, data: { snapshots: [
      { id: 'analytics-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', source: 'youtube_analytics_api', sourceFreshness: 'fresh', periodStart: '2026-06-01', periodEnd: '2026-06-08', clientSummary: 'Retention is strongest in first half.', metrics: { views: 1200, watchTimeMinutes: 540, impressionsCtr: 6.4 } },
    ] } })
    return jsonResponse({ success: true, data: {} })
  })
  global.fetch = fetchMock as jest.Mock
  return fetchMock
}

describe('YouTubeStudioAdminWorkspace command center', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('surfaces the admin command-center queues and risk/channel filters', async () => {
    installYoutubeStudioFetch()

    render(<YouTubeStudioAdminWorkspace orgId="pib-platform-owner" orgName="Partners in Biz" />)

    const commandCenter = await screen.findByRole('region', { name: 'YouTube admin command center' })
    expect(within(commandCenter).getByText('Urgency queue')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Active jobs')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Approvals waiting')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Publish-ready packets')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Live metrics')).toBeInTheDocument()
    expect(within(commandCenter).getByRole('link', { name: 'Open Lumen Growth Channel channel detail' })).toHaveAttribute('href', '#youtube-channel-channel-1')

    fireEvent.change(within(commandCenter).getByLabelText('Risk filter'), { target: { value: 'blocked' } })
    expect(screen.getByText('Velox Risk Channel')).toBeInTheDocument()
    expect(screen.queryByText('Proof-led launch cockpit')).not.toBeInTheDocument()

    fireEvent.change(within(commandCenter).getByLabelText('Risk filter'), { target: { value: 'all' } })
    fireEvent.change(within(commandCenter).getByLabelText('Channel filter'), { target: { value: 'channel-1' } })
    expect(screen.getByText('Proof-led launch cockpit')).toBeInTheDocument()
    expect(screen.queryByText('Blocked channel setup')).not.toBeInTheDocument()
  })

  it('renders channel detail and video cockpit drilldowns with operational tabs', async () => {
    installYoutubeStudioFetch()

    render(<YouTubeStudioAdminWorkspace orgId="pib-platform-owner" orgName="Partners in Biz" />)

    const channelDetail = await screen.findByRole('region', { name: 'Lumen Growth Channel channel detail' })
    for (const tab of ['Strategy', 'Pipeline', 'Series', 'Assets', 'Approvals', 'Analytics', 'Publishing settings', 'API connection', 'Defaults', 'Access']) {
      expect(within(channelDetail).getByRole('button', { name: tab })).toBeInTheDocument()
    }
    expect(within(channelDetail).getByText('B2B founders and operations leads')).toBeInTheDocument()

    fireEvent.click(within(channelDetail).getByRole('button', { name: 'API connection' }))
    expect(within(channelDetail).getByText(/connected/)).toBeInTheDocument()
    expect(within(channelDetail).getByText(/verified/)).toBeInTheDocument()

    const cockpit = screen.getByRole('region', { name: 'Proof-led launch cockpit video cockpit' })
    for (const tab of ['Brief', 'Script', 'Clips', 'Render', 'Thumbnail', 'Metadata', 'Review', 'Publishing', 'Analytics', 'Activity timeline']) {
      expect(within(cockpit).getByRole('button', { name: tab })).toBeInTheDocument()
    }

    fireEvent.click(within(cockpit).getByRole('button', { name: 'Metadata' }))
    expect(within(cockpit).getByText('Draft metadata.')).toBeInTheDocument()

    fireEvent.click(within(cockpit).getByRole('button', { name: 'Activity timeline' }))
    expect(within(cockpit).getByText('Brief accepted for production')).toBeInTheDocument()
  })
})
