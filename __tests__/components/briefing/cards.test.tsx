import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BriefingCardForKind, type BriefingCardActions } from '@/components/briefing/cards/BriefingCardForKind'
import { AgentGroupCard, summariseAgentItems } from '@/components/briefing/cards/AgentGroupCard'
import { snoozeOptionsForKind } from '@/components/briefing/cards/snooze'
import type { BriefingCard } from '@/components/briefing/cockpit/cockpitTypes'

jest.mock('@/components/studio', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

function makeActions(overrides: Partial<BriefingCardActions> = {}): BriefingCardActions {
  return {
    mode: 'portal',
    busy: false,
    select: jest.fn(),
    openMore: jest.fn(),
    snooze: jest.fn(),
    done: jest.fn(),
    sourceHref: jest.fn(() => '/portal/source'),
    askPip: jest.fn(),
    canApprove: jest.fn(() => false),
    approve: jest.fn(),
    sendBack: jest.fn(),
    canUnblock: jest.fn(() => false),
    unblock: jest.fn(),
    canAssignAgent: jest.fn(() => false),
    assignAgent: jest.fn(),
    agentLabel: jest.fn(() => 'Theo'),
    createFollowUp: jest.fn(),
    canAddMeetLink: jest.fn(() => false),
    addMeetLink: jest.fn(),
    canBookCall: jest.fn(() => false),
    bookCall: jest.fn(async () => undefined),
    snoozeUntil: jest.fn(),
    canStopRun: jest.fn(() => false),
    stopRun: jest.fn(),
    loadBusy: jest.fn(async () => []),
    ...overrides,
  }
}

function makeItem(overrides: Partial<BriefingCard>): BriefingCard {
  return {
    id: 'item-1',
    orgId: 'org-1',
    priority: 'needs-peet',
    title: 'Card title',
    summary: 'Card summary',
    timeAgo: '5 minutes ago',
    source: { type: 'task', id: 'task-1' },
    actor: { id: 'user:1', name: 'Peet', type: 'user' },
    context: { orgId: 'org-1' },
    metadata: {},
    occurredAt: '2026-09-03T10:00:00.000Z',
    ...overrides,
  } as BriefingCard
}

describe('BriefingCardForKind', () => {
  it('renders a booking as a meeting card with Add Meet link when the link is missing', () => {
    const actions = makeActions({ canAddMeetLink: jest.fn(() => true) })
    const item = makeItem({
      title: 'Booking needs Meet link: Mia Founder',
      source: { type: 'booking', id: 'booking-1' },
      context: { orgId: 'org-1', bookingName: 'Mia Founder' },
      metadata: { date: '2026-09-04', time: '10:00', email: 'mia@example.test', company: 'Founder Co' },
    })
    render(<BriefingCardForKind item={item} actions={actions} />)

    expect(screen.getByTestId('briefing-card')).toHaveAttribute('data-work-kind', 'meeting')
    expect(screen.getByTestId('briefing-card-title')).toHaveTextContent('Booking needs Meet link: Mia Founder')
    expect(screen.getByText('Meet link missing')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /add meet link/i }))
    expect(actions.addMeetLink).toHaveBeenCalledWith(item)
  })

  it('renders Join when the booking already has a Meet link', () => {
    const item = makeItem({
      source: { type: 'booking', id: 'booking-2' },
      metadata: { meetLink: 'https://meet.google.com/abc-defg-hij', date: '2026-09-04', time: '10:00' },
    })
    render(<BriefingCardForKind item={item} actions={makeActions()} />)
    expect(screen.getByRole('link', { name: /join/i })).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij')
    expect(screen.getByText('Meet ready')).toBeInTheDocument()
  })

  it('books a call from a CRM contact card through the schedule-meeting action', async () => {
    const bookCall = jest.fn(async () => undefined)
    const actions = makeActions({ canBookCall: jest.fn(() => true), bookCall })
    const item = makeItem({
      title: 'Follow up with Jane Buyer',
      source: { type: 'contact', id: 'contact-1' },
      context: { orgId: 'org-1', contactId: 'contact-1', contactName: 'Jane Buyer', companyName: 'Acme' },
      metadata: { email: 'jane@acme.test', phone: '+27820000000' },
    })
    render(<BriefingCardForKind item={item} actions={actions} />)

    expect(screen.getByTestId('briefing-card')).toHaveAttribute('data-work-kind', 'meeting')
    expect(screen.getByRole('link', { name: /^call$/i })).toHaveAttribute('href', 'tel:+27820000000')
    fireEvent.click(screen.getByRole('button', { name: /book call/i }))
    const form = screen.getByRole('form', { name: /book a call with jane buyer/i })
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-09-05T10:00' } })
    fireEvent.submit(form)
    await screen.findByRole('button', { name: /book call/i })
    expect(bookCall).toHaveBeenCalledWith(item, expect.objectContaining({ title: 'Call with Jane Buyer', startAt: expect.any(String), endAt: expect.any(String) }))
  })

  it('renders an unread email as a reply card with Gmail and Ask Pip actions', () => {
    const actions = makeActions()
    const item = makeItem({
      title: 'Unread email from Client Lead',
      source: { type: 'mailbox-message', id: 'msg-1' },
      context: { orgId: 'org-1', mailboxFrom: 'Client Lead', mailboxSubject: 'Can we book a call?' },
      metadata: { threadId: 'thread-123', email: 'lead@example.test' },
      excerpt: 'Hi, do you have time next week?',
    })
    render(<BriefingCardForKind item={item} actions={actions} />)

    expect(screen.getByTestId('briefing-card')).toHaveAttribute('data-work-kind', 'reply')
    expect(screen.getByText('Can we book a call?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /gmail/i })).toHaveAttribute('href', 'https://mail.google.com/mail/u/0/#inbox/thread-123')
    fireEvent.click(screen.getByRole('button', { name: /ask pip to draft a reply/i }))
    expect(actions.askPip).toHaveBeenCalledWith(item)
    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }))
    expect(actions.openMore).toHaveBeenCalledWith(item)
  })

  it('renders a social post as an approval card with Approve and Request changes', () => {
    const actions = makeActions({ canApprove: jest.fn(() => true) })
    const item = makeItem({
      title: 'Social post awaiting client approval',
      priority: 'needs-peet',
      source: { type: 'social-post', id: 'post-1' },
      actor: { id: 'agent:maya', name: 'Maya', type: 'agent' },
      metadata: { actionStage: 'client', platforms: ['linkedin'] },
      excerpt: 'Launch offer post copy',
    })
    render(<BriefingCardForKind item={item} actions={actions} />)

    expect(screen.getByTestId('briefing-card')).toHaveAttribute('data-work-kind', 'approval')
    expect(screen.getByText(/Social post · from Maya/)).toBeInTheDocument()
    expect(screen.getByText('linkedin')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    expect(actions.approve).toHaveBeenCalledWith(item)
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }))
    expect(actions.openMore).toHaveBeenCalledWith(item)
  })

  it('renders a running agent run as an agent card with a status pill', () => {
    const item = makeItem({
      title: 'Theo is running: Landing page copy',
      priority: 'progress',
      source: { type: 'agent-run', id: 'run-1' },
      actor: { id: 'agent:theo', name: 'Theo', type: 'agent' },
      context: { orgId: 'org-1', taskTitle: 'Landing page copy', projectName: 'Website' },
      metadata: { runStatus: 'running', agentId: 'theo' },
    })
    render(<BriefingCardForKind item={item} actions={makeActions()} />)

    expect(screen.getByTestId('briefing-card')).toHaveAttribute('data-work-kind', 'agent')
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText(/Theo · Agent run/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open task/i })).toHaveAttribute('href', '/portal/source')
  })

  it('renders a blocked task with the blocker reason and Unblock / Assign actions', () => {
    const actions = makeActions({ canUnblock: jest.fn(() => true), canAssignAgent: jest.fn(() => true) })
    const item = makeItem({
      title: 'Blocked: Deploy staging',
      priority: 'critical',
      source: { type: 'task', id: 'task-9' },
      context: { orgId: 'org-1', taskTitle: 'Deploy staging', projectName: 'Website' },
      metadata: { agentStatus: 'blocked', blockingReason: 'Waiting for Vercel credentials', needsPeet: true, assigneeAgentId: 'theo' },
    })
    render(<BriefingCardForKind item={item} actions={actions} />)

    expect(screen.getByTestId('briefing-card')).toHaveAttribute('data-work-kind', 'blocked')
    expect(screen.getByText(/Waiting for Vercel credentials/)).toBeInTheDocument()
    expect(screen.getByText('Needs you')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^unblock$/i }))
    expect(actions.unblock).toHaveBeenCalledWith(item)
    fireEvent.click(screen.getByRole('button', { name: /assign theo/i }))
    expect(actions.assignAgent).toHaveBeenCalledWith(item)
  })

  it('honours a server-stamped workKind over local classification', () => {
    const item = makeItem({ source: { type: 'contact', id: 'contact-2' }, workKind: 'blocked' })
    render(<BriefingCardForKind item={item} actions={makeActions()} />)
    expect(screen.getByTestId('briefing-card')).toHaveAttribute('data-work-kind', 'blocked')
  })

  it('snoozes 24h from the shared frame menu and opens more actions', () => {
    const actions = makeActions()
    const item = makeItem({ source: { type: 'comment', id: 'c-1' } })
    render(<BriefingCardForKind item={item} actions={actions} />)
    const trigger = screen.getByTitle('Snooze')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: '24 hours' }))
    expect(actions.snooze).toHaveBeenCalledWith(item)
    expect(actions.snoozeUntil).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('More actions'))
    expect(actions.openMore).toHaveBeenCalledWith(item)
  })

  it('opens the snooze menu with reply presets and calls snoozeUntil with a future ISO', () => {
    const actions = makeActions()
    const item = makeItem({ source: { type: 'comment', id: 'c-2' } })
    render(<BriefingCardForKind item={item} actions={actions} />)
    fireEvent.click(screen.getByTitle('Snooze'))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((node) => node.textContent)).toEqual(['In 3 hours', 'Tomorrow 09:00', 'Next Monday 09:00', '24 hours'])
    const before = Date.now()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Tomorrow 09:00' }))
    expect(actions.snoozeUntil).toHaveBeenCalledTimes(1)
    const [calledItem, untilIso] = (actions.snoozeUntil as jest.Mock).mock.calls[0]
    expect(calledItem).toBe(item)
    const until = new Date(untilIso)
    expect(Number.isNaN(until.getTime())).toBe(false)
    expect(until.getTime()).toBeGreaterThan(before)
    expect(until.getHours()).toBe(9)
    expect(until.getMinutes()).toBe(0)
    expect(actions.snooze).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the snooze menu on Escape and on outside click without snoozing', () => {
    const actions = makeActions()
    const item = makeItem({ source: { type: 'comment', id: 'c-3' } })
    render(<BriefingCardForKind item={item} actions={actions} />)
    fireEvent.click(screen.getByTitle('Snooze'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Snooze'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(actions.snooze).not.toHaveBeenCalled()
    expect(actions.snoozeUntil).not.toHaveBeenCalled()
  })

  it('offers "1 hour before" on a meeting card whose start is more than an hour away', () => {
    const actions = makeActions()
    const start = new Date(Date.now() + 5 * 60 * 60 * 1000)
    const item = makeItem({ source: { type: 'calendar-event', id: 'evt-1' }, metadata: { startAt: start.toISOString() } })
    render(<BriefingCardForKind item={item} actions={actions} />)
    fireEvent.click(screen.getByTitle('Snooze'))
    fireEvent.click(screen.getByRole('menuitem', { name: '1 hour before' }))
    const [, untilIso] = (actions.snoozeUntil as jest.Mock).mock.calls[0]
    expect(new Date(untilIso).getTime()).toBe(start.getTime() - 60 * 60 * 1000)
  })

  it('shows Stop run on an agent card only when canStopRun allows it', () => {
    const item = makeItem({
      title: 'Theo is running: Landing page copy',
      priority: 'progress',
      source: { type: 'agent-run', id: 'run-2' },
      actor: { id: 'agent:theo', name: 'Theo', type: 'agent' },
      metadata: { runStatus: 'running', agentId: 'theo' },
    })
    const { unmount } = render(<BriefingCardForKind item={item} actions={makeActions()} />)
    expect(screen.queryByRole('button', { name: /stop run/i })).not.toBeInTheDocument()
    unmount()

    const actions = makeActions({ canStopRun: jest.fn(() => true) })
    render(<BriefingCardForKind item={item} actions={actions} />)
    expect(screen.getByText('Running')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /stop run/i }))
    expect(actions.stopRun).toHaveBeenCalledWith(item)
  })

  it('loads busy blocks for the chosen day in Book call and flags overlaps', async () => {
    const loadBusy = jest.fn(async (date: string) => (date === '2026-09-05' ? [{ start: '2026-09-05T10:00:00', end: '2026-09-05T10:30:00', title: 'Buhle' }] : []))
    const actions = makeActions({ canBookCall: jest.fn(() => true), loadBusy })
    const item = makeItem({
      title: 'Follow up with Jane Buyer',
      source: { type: 'contact', id: 'contact-3' },
      context: { orgId: 'org-1', contactId: 'contact-3', contactName: 'Jane Buyer' },
      metadata: { email: 'jane@acme.test', phone: '+27820000000' },
    })
    render(<BriefingCardForKind item={item} actions={actions} />)
    fireEvent.click(screen.getByRole('button', { name: /book call/i }))
    await waitFor(() => expect(loadBusy).toHaveBeenCalledTimes(1))
    expect(loadBusy.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(screen.getByRole('button', { name: /create invite/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-09-05T10:15' } })
    await waitFor(() => expect(loadBusy).toHaveBeenCalledWith('2026-09-05'))
    expect(await screen.findByText('Overlaps with 10:00–10:30 Buhle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /book anyway/i })).toBeInTheDocument()

    // Moving off the busy block clears the warning without another fetch (same day).
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-09-05T11:00' } })
    await waitFor(() => expect(screen.queryByText(/Overlaps with/)).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /create invite/i })).toBeInTheDocument()
    expect(loadBusy).toHaveBeenCalledTimes(2)
  })

  it('shows nothing when loadBusy rejects and still lets the call be booked', async () => {
    const bookCall = jest.fn(async () => undefined)
    const actions = makeActions({ canBookCall: jest.fn(() => true), bookCall, loadBusy: jest.fn(async () => { throw new Error('calendar offline') }) })
    const item = makeItem({ source: { type: 'contact', id: 'contact-4' }, context: { orgId: 'org-1', contactName: 'Jane Buyer' }, metadata: { phone: '+27820000000' } })
    render(<BriefingCardForKind item={item} actions={actions} />)
    fireEvent.click(screen.getByRole('button', { name: /book call/i }))
    await waitFor(() => expect(actions.loadBusy).toHaveBeenCalled())
    expect(screen.queryByText(/Overlaps with/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Busy on this day')).not.toBeInTheDocument()
    fireEvent.submit(screen.getByRole('form', { name: /book a call with jane buyer/i }))
    await waitFor(() => expect(bookCall).toHaveBeenCalledTimes(1))
  })
})

describe('snoozeOptionsForKind', () => {
  // Wednesday 2 Sep 2026, 14:30 local time.
  const now = new Date(2026, 8, 2, 14, 30, 0, 0)

  function labels(options: ReturnType<typeof snoozeOptionsForKind>) {
    return options.map((option) => option.label)
  }

  it('returns lane-specific presets in order', () => {
    expect(labels(snoozeOptionsForKind('reply', now))).toEqual(['In 3 hours', 'Tomorrow 09:00', 'Next Monday 09:00'])
    expect(labels(snoozeOptionsForKind('approval', now))).toEqual(['Tomorrow 09:00', 'In 3 days 09:00'])
    expect(labels(snoozeOptionsForKind('agent', now))).toEqual(['In 4 hours', 'Tomorrow 09:00'])
    expect(labels(snoozeOptionsForKind('blocked', now))).toEqual(['Tomorrow 09:00', 'Next Monday 09:00'])
    expect(labels(snoozeOptionsForKind('meeting', now))).toEqual(['Tomorrow 09:00', 'In 3 days 09:00'])
  })

  it('computes 09:00 local targets and relative offsets from now', () => {
    const reply = snoozeOptionsForKind('reply', now)
    expect(reply[0].until.getTime()).toBe(now.getTime() + 3 * 60 * 60 * 1000)
    expect(reply[1].until).toEqual(new Date(2026, 8, 3, 9, 0, 0, 0))
    expect(reply[2].until).toEqual(new Date(2026, 8, 7, 9, 0, 0, 0))
    const approval = snoozeOptionsForKind('approval', now)
    expect(approval[1].until).toEqual(new Date(2026, 8, 5, 9, 0, 0, 0))
    expect(snoozeOptionsForKind('agent', now)[0].until.getTime()).toBe(now.getTime() + 4 * 60 * 60 * 1000)
    for (const kind of ['meeting', 'reply', 'approval', 'agent', 'blocked'] as const) {
      for (const option of snoozeOptionsForKind(kind, now)) expect(option.until.getTime()).toBeGreaterThan(now.getTime())
    }
  })

  it('skips to the following week when today is Monday', () => {
    const monday = new Date(2026, 8, 7, 8, 0, 0, 0)
    const blocked = snoozeOptionsForKind('blocked', monday)
    expect(blocked[1].label).toBe('Next Monday 09:00')
    expect(blocked[1].until).toEqual(new Date(2026, 8, 14, 9, 0, 0, 0))
  })

  it('offers "1 hour before" for meetings only when the start is more than an hour away', () => {
    const farStart = new Date(2026, 8, 2, 17, 0, 0, 0).toISOString()
    const far = snoozeOptionsForKind('meeting', now, farStart)
    expect(labels(far)).toEqual(['1 hour before', 'Tomorrow 09:00', 'In 3 days 09:00'])
    expect(far[0].until).toEqual(new Date(2026, 8, 2, 16, 0, 0, 0))

    const soonStart = new Date(2026, 8, 2, 15, 0, 0, 0).toISOString()
    expect(labels(snoozeOptionsForKind('meeting', now, soonStart))).toEqual(['Tomorrow 09:00', 'In 3 days 09:00'])
    expect(labels(snoozeOptionsForKind('meeting', now, 'not-a-date'))).toEqual(['Tomorrow 09:00', 'In 3 days 09:00'])
    expect(labels(snoozeOptionsForKind('meeting', now, null))).toEqual(['Tomorrow 09:00', 'In 3 days 09:00'])
  })
})

describe('AgentGroupCard', () => {
  function agentItem(id: string, overrides: Partial<BriefingCard>): BriefingCard {
    return makeItem({
      id,
      priority: 'progress',
      source: { type: 'agent-run', id },
      actor: { id: 'agent:theo', name: 'Theo', type: 'agent' },
      ...overrides,
    })
  }

  const items = [
    agentItem('r1', { title: 'Theo is running: Landing page copy', metadata: { runStatus: 'running' } }),
    agentItem('r2', { title: 'Theo is running: Pricing page', metadata: { runStatus: 'running' } }),
    agentItem('r3', { title: 'Theo waiting for approval: Blog outline', metadata: { runStatus: 'waiting_approval' } }),
    agentItem('r4', { title: 'Theo finished: Sitemap', metadata: { runStatus: 'completed' } }),
    agentItem('r5', { title: 'Theo is working on the FAQ', metadata: {} }),
  ]

  it('summarises items by run state with title fallbacks', () => {
    const summary = summariseAgentItems(items)
    expect(summary.total).toBe(5)
    expect(summary.counts).toEqual({ running: 3, waiting: 1, queued: 0, done: 1, failed: 0, other: 0 })
    expect(summary.label).toBe('3 running · 1 waiting · 1 done')
    expect(summariseAgentItems([]).label).toBe('Nothing in flight')
    expect(summariseAgentItems([agentItem('x', { title: 'Something odd', metadata: {} })]).label).toBe('1 item')
    expect(summariseAgentItems([agentItem('f', { title: 'Run', metadata: { runStatus: 'failed' } })]).label).toBe('1 failed')
  })

  it('shows only the summary when collapsed and lists titles when expanded', () => {
    const actions = makeActions()
    const onToggle = jest.fn()
    const { rerender } = render(<AgentGroupCard agentId="theo" agentName="Theo" items={items} actions={actions} expanded={false} onToggle={onToggle} />)

    const card = screen.getByTestId('briefing-card')
    expect(card).toHaveAttribute('data-work-kind', 'agent')
    expect(card).toHaveAttribute('data-agent-id', 'theo')
    expect(screen.getByText('Theo')).toBeInTheDocument()
    expect(screen.getByTestId('agent-group-summary')).toHaveTextContent('3 running · 1 waiting · 1 done')
    expect(screen.queryAllByTestId('briefing-card-title')).toHaveLength(0)

    fireEvent.click(screen.getByTitle('Expand'))
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<AgentGroupCard agentId="theo" agentName="Theo" items={items} actions={actions} expanded onToggle={onToggle} />)
    const titles = screen.getAllByTestId('briefing-card-title')
    expect(titles).toHaveLength(5)
    expect(titles[0]).toHaveTextContent('Theo is running: Landing page copy')
    fireEvent.click(titles[2])
    expect(actions.select).toHaveBeenCalledWith(items[2])
    const opens = screen.getAllByRole('link', { name: 'Open' })
    expect(opens).toHaveLength(5)
    expect(opens[0]).toHaveAttribute('href', '/portal/source')
    fireEvent.click(screen.getByTitle('Collapse'))
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('omits the Open link when there is no source href', () => {
    const actions = makeActions({ sourceHref: jest.fn(() => null) })
    render(<AgentGroupCard agentId="theo" agentName="Theo" items={items.slice(0, 1)} actions={actions} expanded onToggle={jest.fn()} />)
    expect(screen.getAllByTestId('briefing-card-title')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument()
  })
})
