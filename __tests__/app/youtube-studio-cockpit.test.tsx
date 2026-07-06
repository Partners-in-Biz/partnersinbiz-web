import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { YouTubeStudioChannelHeader } from '@/components/youtube-studio/YouTubeStudioChannelHeader'
import type { YouTubeChannelWorkspace } from '@/lib/youtube-studio/types'

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
