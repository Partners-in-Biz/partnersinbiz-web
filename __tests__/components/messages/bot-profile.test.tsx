import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BotAvatar, botAvatarActivity } from '@/components/messages/bot-mode/BotAvatar'
import { BotProfileCard } from '@/components/messages/bot-mode/BotProfileCard'
import { PinnedBotStrip } from '@/components/messages/bot-mode/PinnedBotStrip'
import { BOT_LONG_PRESS_MS } from '@/components/messages/bot-mode/BotRowMenu'
import { BotRoster } from '@/components/messages/bot-mode/BotRoster'
import { BotModeLanding } from '@/components/messages/bot-mode/BotModeLanding'
import { BotDeskPanel } from '@/components/messages/bot-mode/BotDeskPanel'
import type { BotRosterItem } from '@/lib/messages/bot-roster'

const theo: BotRosterItem = {
  id: 'theo',
  name: 'Theo',
  role: 'Engineering',
  channelCount: 1,
  lastPreview: 'Ship the preview',
  onlineComputerCount: 1,
  colorKey: 'sky',
}
const maya: BotRosterItem = { id: 'maya', name: 'Maya', role: 'Content', channelCount: 0, onlineComputerCount: 0, colorKey: 'amber' }

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify({ success: status < 400, data, error: status >= 400 ? (data as { error?: string })?.error : undefined }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

function installMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
}

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  // @ts-expect-error test cleanup of the jsdom shim
  delete window.matchMedia
})

describe('BotAvatar motion', () => {
  it('animates by default and intensifies while the bot is working', () => {
    installMatchMedia(false)
    const { rerender } = render(<BotAvatar name="Theo" colorKey="sky" testId="avatar" />)
    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveAttribute('data-style', 'blob')
    expect(avatar).toHaveAttribute('data-motion', 'animate')
    expect(avatar).toHaveAttribute('data-activity', 'idle')
    rerender(<BotAvatar name="Theo" colorKey="sky" activity={botAvatarActivity({ presence: 'working' })} testId="avatar" />)
    expect(avatar).toHaveAttribute('data-activity', 'working')
    expect(botAvatarActivity({ presence: 'idle', streaming: true })).toBe('working')
    expect(botAvatarActivity({ presence: 'blocked' })).toBe('waiting')
  })

  it('falls back to a static frame under prefers-reduced-motion', async () => {
    installMatchMedia(true)
    render(<BotAvatar name="Theo" colorKey="sky" activity="working" testId="avatar" />)
    await waitFor(() => expect(screen.getByTestId('avatar')).toHaveAttribute('data-motion', 'static'))
  })

  it('renders an uploaded still when the image style is active and a geometric body otherwise', () => {
    const { rerender } = render(<BotAvatar name="Theo" avatarUrl="https://cdn.test/theo.png" avatarStyle="image" testId="avatar" />)
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-style', 'image')
    expect(screen.getByTestId('avatar').querySelector('img')).toHaveAttribute('src', 'https://cdn.test/theo.png')
    rerender(<BotAvatar name="Theo" avatarStyle="geometric" testId="avatar" />)
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-style', 'geometric')
    expect(screen.getByTestId('avatar').querySelector('.bot-avatar__facet')).not.toBeNull()
  })
})

describe('pinned bot strip', () => {
  it('opens the pinned bot with one tap and unpins from the long-press menu', () => {
    jest.useFakeTimers()
    try {
      const onOpen = jest.fn()
      const onUnpin = jest.fn()
      render(<PinnedBotStrip bots={[{ ...theo, presence: { state: 'working', currentStep: 'Running tests' } }]} onOpen={onOpen} onUnpin={onUnpin} />)
      expect(screen.getByTestId('pinned-bot-strip')).toHaveTextContent('Theo')
      expect(screen.getByTestId('pinned-bot-avatar-theo')).toHaveAttribute('data-activity', 'working')
      const item = screen.getByRole('button', { name: 'Open pinned bot Theo' })
      fireEvent.click(item)
      expect(onOpen).toHaveBeenCalledWith('theo')

      fireEvent.pointerDown(item, { button: 0 })
      act(() => { jest.advanceTimersByTime(BOT_LONG_PRESS_MS + 10) })
      fireEvent.pointerUp(item)
      fireEvent.click(item)
      expect(onOpen).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByTestId('bot-row-menu-unpin'))
      expect(onUnpin).toHaveBeenCalledWith('theo')
      expect(screen.queryByTestId('bot-row-menu')).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('renders nothing when there is no pinned bot', () => {
    render(<PinnedBotStrip bots={[]} onOpen={jest.fn()} />)
    expect(screen.queryByTestId('pinned-bot-strip')).not.toBeInTheDocument()
  })

  it('shows on the Bot mode landing and opens the canonical chat', () => {
    const onOpenBot = jest.fn()
    render(<BotModeLanding bots={[theo, maya]} computers={[]} pinnedBotId="maya" onOpenBot={onOpenBot} />)
    expect(screen.getByTestId('pinned-bot-maya')).toBeInTheDocument()
    expect(screen.queryByTestId('pinned-bot-theo')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open pinned bot Maya' }))
    expect(onOpenBot).toHaveBeenCalledWith('maya')
  })

  it('pins from the roster row menu via right-click and opens Bot settings', () => {
    const onTogglePin = jest.fn()
    const onOpenSettings = jest.fn()
    const onSelectBot = jest.fn()
    render(<BotRoster bots={[theo, maya]} pinnedBotId="theo" onSelectBot={onSelectBot} onTogglePin={onTogglePin} onOpenSettings={onOpenSettings} />)
    expect(screen.getByTestId('bot-roster-card-theo')).toHaveAttribute('data-pinned', 'true')

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Maya' }))
    expect(screen.getByRole('menu', { name: 'Maya actions' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('bot-row-menu-pin'))
    expect(onTogglePin).toHaveBeenCalledWith('maya')
    expect(onSelectBot).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('bot-roster-menu-theo'))
    expect(screen.getByTestId('bot-row-menu-unpin')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('bot-row-menu-settings'))
    expect(onOpenSettings).toHaveBeenCalledWith('theo')
  })
})

describe('BotProfileCard', () => {
  it('lets the user pick a built-in animated style and reports the saved look', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/appearance') && (!init || !init.method)) {
        return jsonResponse({ agentId: 'theo', avatarUrl: null, avatarStyle: 'blob', mailbox: null, canEditLook: true, canProvisionMailbox: false })
      }
      if (url.endsWith('/appearance') && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ avatarStyle: 'geometric' })
        return jsonResponse({ agentId: 'theo', avatarUrl: null, avatarStyle: 'geometric' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const onAppearanceSaved = jest.fn()
    render(<BotProfileCard orgId="org-1" bot={theo} onAppearanceSaved={onAppearanceSaved} />)
    await waitFor(() => expect(screen.getByTestId('bot-avatar-style-geometric')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('bot-avatar-style-geometric'))
    await waitFor(() => expect(onAppearanceSaved).toHaveBeenCalledWith('theo', { avatarUrl: null, avatarStyle: 'geometric' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/orgs/org-1/bots/theo/appearance', expect.objectContaining({ method: 'PATCH' }))
  })

  it('uploads a still through the avatar endpoint and rejects oversized or non-image files client-side', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/appearance')) {
        return jsonResponse({ agentId: 'theo', avatarUrl: null, avatarStyle: 'blob', mailbox: null, canEditLook: true, canProvisionMailbox: false })
      }
      if (url.endsWith('/avatar') && init?.method === 'POST') {
        expect(init.body).toBeInstanceOf(FormData)
        return jsonResponse({ agentId: 'theo', avatarUrl: 'https://cdn.test/theo.png', avatarStyle: 'image' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const onAppearanceSaved = jest.fn()
    render(<BotProfileCard orgId="org-1" bot={theo} onAppearanceSaved={onAppearanceSaved} />)
    const input = await screen.findByTestId('bot-avatar-upload') as HTMLInputElement
    await waitFor(() => expect(input).not.toBeDisabled())

    const tooBig = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    await act(async () => { fireEvent.change(input, { target: { files: [tooBig] } }) })
    expect(screen.getByTestId('bot-look-error')).toHaveTextContent('Maximum size is 2MB')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/avatar'), expect.anything())

    const wrongType = new File(['x'], 'clip.webm', { type: 'video/webm' })
    await act(async () => { fireEvent.change(input, { target: { files: [wrongType] } }) })
    expect(screen.getByTestId('bot-look-error')).toHaveTextContent('PNG, JPG, WebP, or GIF')

    const good = new File(['png'], 'theo.png', { type: 'image/png' })
    await act(async () => { fireEvent.change(input, { target: { files: [good] } }) })
    await waitFor(() => expect(onAppearanceSaved).toHaveBeenCalledWith('theo', { avatarUrl: 'https://cdn.test/theo.png', avatarStyle: 'image' }))
  })

  it('shows the bot email when provisioned and never invents one otherwise', async () => {
    global.fetch = jest.fn(() => jsonResponse({
      agentId: 'theo',
      avatarUrl: null,
      avatarStyle: 'blob',
      mailbox: { provider: 'hermes-mail-agent', address: 'theo@bots.example.test', inboxId: 'inb_1', status: 'active', updatedAt: '2026-09-05T00:00:00.000Z' },
      canEditLook: true,
      canProvisionMailbox: true,
    })) as unknown as typeof fetch
    const { rerender } = render(<BotProfileCard orgId="org-1" bot={maya} />)
    await waitFor(() => expect(screen.getByTestId('bot-avatar-style-blob')).not.toBeDisabled())
    expect(screen.getByTestId('bot-mailbox-status')).toHaveTextContent('No mailbox yet')
    expect(screen.queryByTestId('bot-mailbox-address')).not.toBeInTheDocument()

    rerender(<BotProfileCard orgId="org-1" bot={{ ...maya, mailbox: { provider: 'hermes-mail-agent', address: 'maya@bots.example.test', inboxId: null, status: 'active', updatedAt: '2026-09-05T00:00:00.000Z' } }} />)
    expect(screen.getByTestId('bot-mailbox-address')).toHaveTextContent('maya@bots.example.test')
    expect(screen.getByText(/sends and receives as this address through the Hermes Mail Agent/i)).toBeInTheDocument()
  })

  it('provisions a mailbox through the Hermes Mail Agent path and surfaces the [NEED] when it is missing', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/appearance')) {
        return jsonResponse({ agentId: 'theo', avatarUrl: null, avatarStyle: 'blob', mailbox: null, canEditLook: true, canProvisionMailbox: true })
      }
      if (url.endsWith('/mailbox') && init?.method === 'POST') {
        return jsonResponse({ error: '[NEED] Hermes Mail Agent is not installed on this Bot\'s runtime.' }, 503)
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const onMailboxChanged = jest.fn()
    render(<BotProfileCard orgId="org-1" bot={theo} onMailboxChanged={onMailboxChanged} />)
    const provision = await screen.findByTestId('bot-mailbox-provision')
    fireEvent.click(provision)
    await waitFor(() => expect(screen.getByTestId('bot-mailbox-error')).toHaveTextContent('[NEED] Hermes Mail Agent'))
    expect(screen.queryByTestId('bot-mailbox-address')).not.toBeInTheDocument()
    expect(onMailboxChanged).not.toHaveBeenCalledWith('theo', expect.objectContaining({ status: 'active' }))

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/mailbox') && init?.method === 'POST') {
        return jsonResponse({ agentId: 'theo', mailbox: { provider: 'hermes-mail-agent', address: 'theo@bots.example.test', inboxId: 'inb_1', status: 'active', updatedAt: 'now' }, canProvisionMailbox: true }, 201)
      }
      return jsonResponse({ agentId: 'theo', avatarUrl: null, avatarStyle: 'blob', mailbox: null, canEditLook: true, canProvisionMailbox: true })
    })
    fireEvent.click(screen.getByTestId('bot-mailbox-provision'))
    await waitFor(() => expect(onMailboxChanged).toHaveBeenCalledWith('theo', expect.objectContaining({ address: 'theo@bots.example.test', status: 'active' })))
  })

  it('renders inside the desk panel profile slot with the pin control', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => (
      String(input).endsWith('/appearance')
        ? jsonResponse({ agentId: 'theo', avatarUrl: null, avatarStyle: 'blob', mailbox: null, canEditLook: true, canProvisionMailbox: false })
        : jsonResponse({ routines: [] })
    )) as unknown as typeof fetch
    const onTogglePin = jest.fn()
    render(
      <BotDeskPanel
        botId="theo"
        botName="Theo"
        computers={[]}
        profile={<BotProfileCard orgId="org-1" bot={theo} pinned onTogglePin={onTogglePin} />}
      />,
    )
    expect(screen.getByTestId('bot-desk-panel')).toContainElement(screen.getByTestId('bot-profile-card'))
    expect(screen.getByTestId('bot-profile-avatar')).toHaveAttribute('data-style', 'blob')
    await waitFor(() => expect(screen.getByTestId('bot-avatar-style-blob')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('bot-profile-pin'))
    expect(onTogglePin).toHaveBeenCalledWith('theo')
  })
})
