import { fireEvent, render, screen } from '@testing-library/react'
import { BriefingCardForKind, type BriefingCardActions } from '@/components/briefing/cards/BriefingCardForKind'
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

  it('snoozes from the shared frame', () => {
    const actions = makeActions()
    const item = makeItem({ source: { type: 'comment', id: 'c-1' } })
    render(<BriefingCardForKind item={item} actions={actions} />)
    fireEvent.click(screen.getByTitle('Snooze 24h'))
    expect(actions.snooze).toHaveBeenCalledWith(item)
    fireEvent.click(screen.getByTitle('More actions'))
    expect(actions.openMore).toHaveBeenCalledWith(item)
  })
})
