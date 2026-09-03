import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TodayRail } from '@/components/briefing/cockpit/TodayRail'

jest.mock('@/components/studio', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

const laneCounts = { meeting: 6, reply: 40, approval: 31, agent: 190, blocked: 12 }

function unreadMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `m-${index}`, from: 'Lead', subject: `Subject ${index}`, snippet: '', receivedAt: null, read: false, accountEmail: 'me@pib.test' }))
}

function mockFetch(calendar: unknown, inbox: { ok: boolean; messages?: unknown[] }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/v1/workspace/calendar/today')) {
      return { ok: true, json: async () => ({ data: calendar }) } as Response
    }
    if (url.startsWith('/api/v1/portal/email/messages') || url.startsWith('/api/v1/admin/mailbox/messages')) {
      return { ok: inbox.ok, json: async () => (inbox.ok ? { data: { messages: inbox.messages ?? [] } } : { error: 'Not connected' }) } as Response
    }
    return { ok: true, json: async () => ({ data: {} }) } as Response
  }) as jest.Mock
}

describe('TodayRail', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-03T07:30:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows upcoming meetings with Join, lane counters, inbox count, Live and Snapshot', async () => {
    mockFetch(
      {
        status: 'connected',
        meetings: [
          { id: 'm-0', title: 'Standup', start: '2026-09-03T05:00:00.000Z', end: '2026-09-03T05:15:00.000Z', allDay: false },
          { id: 'm-1', title: 'Buhle intro', start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T08:30:00.000Z', meetUrl: 'https://meet.google.com/abc', allDay: false },
          { id: 'm-2', title: 'Roadmap', start: '2026-09-03T12:00:00.000Z', end: '2026-09-03T13:00:00.000Z', allDay: false },
        ],
      },
      { ok: true, messages: unreadMessages(7) },
    )
    const onSelectLane = jest.fn()
    const onToggleLive = jest.fn()
    const onSnapshot = jest.fn()

    render(
      <TodayRail
        mode="portal"
        orgId="org-1"
        laneCounts={laneCounts}
        activeLane={null}
        onSelectLane={onSelectLane}
        autoRefresh
        onToggleLive={onToggleLive}
        onSnapshot={onSnapshot}
        snapshotting={false}
        refreshKey={0}
      />,
    )

    const join = await screen.findByRole('link', { name: /join buhle intro/i })
    expect(join).toHaveAttribute('href', 'https://meet.google.com/abc')
    expect(screen.queryByText('Standup')).not.toBeInTheDocument()
    expect(screen.getByText('Roadmap')).toBeInTheDocument()

    const lanes = screen.getByLabelText('Work lanes')
    fireEvent.click(lanes.querySelector('button')!)
    expect(onSelectLane).toHaveBeenCalledWith('meeting')
    expect(lanes).toHaveTextContent('Replies40')
    expect(lanes).toHaveTextContent('Agent work190')

    await waitFor(() => expect(screen.getByRole('link', { name: /inbox: 7 unread/i })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /inbox: 7 unread/i })).toHaveAttribute('href', '/portal/email')

    fireEvent.click(screen.getByRole('button', { name: /live on/i }))
    expect(onToggleLive).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^snapshot$/i }))
    expect(onSnapshot).toHaveBeenCalled()
  })

  it('offers a Google Calendar connect link when the calendar is not connected', async () => {
    mockFetch({ status: 'not_connected', meetings: [] }, { ok: false })
    render(
      <TodayRail
        mode="admin"
        laneCounts={laneCounts}
        activeLane="reply"
        onSelectLane={jest.fn()}
        autoRefresh={false}
        onToggleLive={jest.fn()}
        onSnapshot={jest.fn()}
        snapshotting={false}
        refreshKey={0}
      />,
    )
    expect(await screen.findByRole('link', { name: /connect google calendar/i })).toHaveAttribute('href', expect.stringContaining('/api/v1/admin/mailbox/google/authorize'))
    expect(screen.queryByRole('link', { name: /inbox/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /replies/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('reloads calendar and inbox when refreshKey changes', async () => {
    mockFetch({ status: 'connected', meetings: [] }, { ok: true, messages: [] })
    const props = {
      mode: 'portal' as const,
      orgId: 'org-1',
      laneCounts,
      activeLane: null,
      onSelectLane: jest.fn(),
      autoRefresh: true,
      onToggleLive: jest.fn(),
      onSnapshot: jest.fn(),
      snapshotting: false,
    }
    const { rerender } = render(<TodayRail {...props} refreshKey={0} />)
    await screen.findByText('No more meetings today')
    const before = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).startsWith('/api/v1/workspace/calendar/today')).length
    rerender(<TodayRail {...props} refreshKey={1} />)
    await waitFor(() => {
      const after = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).startsWith('/api/v1/workspace/calendar/today')).length
      expect(after).toBe(before + 1)
    })
  })
})
