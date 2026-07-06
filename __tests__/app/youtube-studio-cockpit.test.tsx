import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { YouTubeStudioChannelHeader } from '@/components/youtube-studio/YouTubeStudioChannelHeader'
import { YouTubeStudioWorkQueue } from '@/components/youtube-studio/YouTubeStudioWorkQueue'
import { YouTubeStudioDetailsTabs } from '@/components/youtube-studio/YouTubeStudioDetailsTabs'
import { buildWorkQueue } from '@/lib/youtube-studio/work-queue'
import type { YouTubeChannelWorkspace, YouTubeVideoProject } from '@/lib/youtube-studio/types'

function channel(id: string, title: string, extra: Partial<YouTubeChannelWorkspace> = {}): YouTubeChannelWorkspace {
  return {
    id,
    orgId: 'org-1',
    title,
    youtubeHandle: `@${title.toLowerCase().replace(/\s/g, '')}`,
    status: 'active',
    connectedAccountId: 'acct-1',
    publishingReadiness: { accountStatus: 'connected' },
    contentPillars: [],
    avoidTopics: [],
    deleted: false,
    ...extra,
  } as YouTubeChannelWorkspace
}

describe('YouTubeStudioChannelHeader', () => {
  const channels = [channel('channel-1', 'Acme Films'), channel('channel-2', 'Stale', { publishingReadiness: { accountStatus: 'needs_reauth' } })]

  it('renders a channel selector with an all-channels option and fires onSelect', () => {
    const onSelect = jest.fn()
    render(
      <YouTubeStudioChannelHeader
        channels={channels}
        selectedChannelId={null}
        onSelect={onSelect}
        oauthHref="/api/v1/social/oauth/youtube?feature=youtube_studio"
        linkAnotherChannelHref="/api/v1/social/oauth/youtube?prompt=select_account"
      />,
    )
    const selector = screen.getByLabelText('Channel')
    expect(selector).toHaveValue('')
    fireEvent.change(selector, { target: { value: 'channel-2' } })
    expect(onSelect).toHaveBeenCalledWith('channel-2')
  })

  it('shows the connection chip and a reconnect link for the selected channel', () => {
    render(
      <YouTubeStudioChannelHeader
        channels={channels}
        selectedChannelId="channel-2"
        onSelect={jest.fn()}
        oauthHref="/oauth"
        linkAnotherChannelHref="/oauth?prompt=select_account"
      />,
    )
    expect(screen.getByText('Needs reconnect')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/oauth')
  })

  it('offers Link YouTube channel when no channels exist', () => {
    render(
      <YouTubeStudioChannelHeader
        channels={[]}
        selectedChannelId={null}
        onSelect={jest.fn()}
        oauthHref="/oauth"
        linkAnotherChannelHref="/oauth?prompt=select_account"
      />,
    )
    expect(screen.getByRole('link', { name: 'Link YouTube channel' })).toHaveAttribute('href', '/oauth')
    expect(screen.queryByLabelText('Channel')).not.toBeInTheDocument()
  })

  it('offers Link another channel when channels exist', () => {
    render(
      <YouTubeStudioChannelHeader
        channels={channels}
        selectedChannelId={null}
        onSelect={jest.fn()}
        oauthHref="/oauth"
        linkAnotherChannelHref="/oauth?prompt=select_account"
      />,
    )
    expect(screen.getByRole('link', { name: 'Link another channel' })).toHaveAttribute('href', '/oauth?prompt=select_account')
  })
})

function queueVideo(id: string, status: YouTubeVideoProject['status']): YouTubeVideoProject {
  return {
    id,
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    title: `Video ${id}`,
    objective: 'Grow the channel',
    videoType: 'long_form',
    status,
    visibility: { showInClientPortal: true },
    deleted: false,
  } as YouTubeVideoProject
}

describe('YouTubeStudioWorkQueue', () => {
  it('renders the four groups with counts and item cards', () => {
    const groups = buildWorkQueue({
      videos: [queueVideo('v1', 'client_review'), queueVideo('v2', 'production'), queueVideo('v3', 'live')],
      packets: [],
      productionDrafts: [],
      renderJobs: [],
    })
    render(<YouTubeStudioWorkQueue groups={groups} renderItemActions={() => null} />)

    expect(screen.getByRole('heading', { name: /Needs your input/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /In production/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Ready to review/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Scheduled & live/ })).toBeInTheDocument()
    expect(screen.getByText('Video v1')).toBeInTheDocument()
    expect(screen.getByText('Video v2')).toBeInTheDocument()
    expect(screen.getByText('Video v3')).toBeInTheDocument()
    // empty group shows its hint, populated groups do not
    expect(screen.getByText('Approved drafts, renders, and packets ready for a final look appear here.')).toBeInTheDocument()
  })

  it('renders custom actions for items via renderItemActions', () => {
    const groups = buildWorkQueue({
      videos: [queueVideo('v1', 'client_review')],
      packets: [],
      productionDrafts: [],
      renderJobs: [],
    })
    render(
      <YouTubeStudioWorkQueue
        groups={groups}
        renderItemActions={(item) => <button type="button">Decide {item.id}</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Decide v1' })).toBeInTheDocument()
  })

  it('renders a single friendly empty state when the whole queue is empty', () => {
    const groups = buildWorkQueue({ videos: [], packets: [], productionDrafts: [], renderJobs: [] })
    render(<YouTubeStudioWorkQueue groups={groups} renderItemActions={() => null} />)
    expect(screen.getByText(/No video work yet/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Needs your input/ })).not.toBeInTheDocument()
  })
})

const noopDecisions = {
  canReviewApprovals: true,
  draftNotes: {},
  renderNotes: {},
  packetNotes: {},
  reviewingDraftId: null,
  reviewingRenderId: null,
  reviewingPacketId: null,
  onDraftNotesChange: jest.fn(),
  onRenderNotesChange: jest.fn(),
  onPacketNotesChange: jest.fn(),
  onDraftDecision: jest.fn(),
  onRenderDecision: jest.fn(),
  onPacketDecision: jest.fn(),
}

describe('YouTubeStudioDetailsTabs', () => {
  it('renders nothing when every collection is empty', () => {
    const { container } = render(
      <YouTubeStudioDetailsTabs
        sourceAssets={[]}
        clipCandidates={[]}
        productionDrafts={[]}
        renderJobs={[]}
        packets={[]}
        releasePlans={[]}
        analytics={[]}
        {...noopDecisions}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('only renders tabs for populated collections and switches between them', () => {
    render(
      <YouTubeStudioDetailsTabs
        sourceAssets={[{ id: 'a1', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Raw shoot', assetType: 'raw_footage', status: 'ready', deleted: false } as never]}
        clipCandidates={[]}
        productionDrafts={[]}
        renderJobs={[{ id: 'r1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'v1', title: 'Cut A', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'qa_review', versionNumber: 1, timeline: [], deleted: false } as never]}
        packets={[]}
        releasePlans={[]}
        analytics={[]}
        {...noopDecisions}
      />,
    )
    expect(screen.getByRole('tab', { name: /Source assets \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Renders \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Clip candidates/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Packets/ })).not.toBeInTheDocument()

    // first populated tab is active by default
    expect(screen.getByText('Raw shoot')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Renders \(1\)/ }))
    expect(screen.getByText('Cut A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve render' })).toBeInTheDocument()
  })

  it('fires render decisions from the renders tab', () => {
    const onRenderDecision = jest.fn()
    render(
      <YouTubeStudioDetailsTabs
        sourceAssets={[]}
        clipCandidates={[]}
        productionDrafts={[]}
        renderJobs={[{ id: 'r1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'v1', title: 'Cut A', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'qa_review', versionNumber: 1, timeline: [], deleted: false } as never]}
        packets={[]}
        releasePlans={[]}
        analytics={[]}
        {...noopDecisions}
        onRenderDecision={onRenderDecision}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve render' }))
    expect(onRenderDecision).toHaveBeenCalledWith('r1', 'approved')
  })
})
