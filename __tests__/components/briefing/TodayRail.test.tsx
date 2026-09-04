import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CALENDAR_POLL_MS, TodayRail, meetingTiming } from '@/components/briefing/cockpit/TodayRail'

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

function calendarFetchCount(): number {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).startsWith('/api/v1/workspace/calendar/today')).length
}

function inboxFetchCount(): number {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]) => /\/(portal\/email|admin\/mailbox)\/messages/.test(String(url))).length
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

const baseProps = {
  mode: 'portal' as const,
  orgId: 'org-1',
  laneCounts,
  activeLane: null,
  onSelectLane: jest.fn(),
  autoRefresh: true,
  onToggleLive: jest.fn(),
  onSnapshot: jest.fn(),
  snapshotting: false,
  refreshKey: 0,
}

describe('TodayRail', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-03T07:30:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
    // Drop any per-instance override so the jsdom prototype getter ("visible") is back in charge.
    delete (document as unknown as Record<string, unknown>).visibilityState
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

  describe('60-second calendar poll', () => {
    it('fetches the calendar once on mount, then again every 60s while visible, leaving the inbox on the refreshKey cadence', async () => {
      mockFetch({ status: 'connected', meetings: [] }, { ok: true, messages: [] })
      const mountedAt = Date.now()
      render(<TodayRail {...baseProps} />)
      await screen.findByText('No more meetings today')
      expect(calendarFetchCount()).toBe(1)
      const inboxBefore = inboxFetchCount()

      // waitFor advances fake timers while polling, so step to just before the first tick.
      act(() => { jest.advanceTimersByTime(CALENDAR_POLL_MS - (Date.now() - mountedAt) - 1) })
      expect(calendarFetchCount()).toBe(1)

      act(() => { jest.advanceTimersByTime(1) })
      await waitFor(() => expect(calendarFetchCount()).toBe(2))

      act(() => { jest.advanceTimersByTime(CALENDAR_POLL_MS) })
      await waitFor(() => expect(calendarFetchCount()).toBe(3))
      expect(inboxFetchCount()).toBe(inboxBefore)
    })

    it('pauses while the document is hidden and reloads immediately when it becomes visible again', async () => {
      mockFetch({ status: 'connected', meetings: [] }, { ok: true, messages: [] })
      render(<TodayRail {...baseProps} />)
      await screen.findByText('No more meetings today')
      expect(calendarFetchCount()).toBe(1)

      act(() => { setVisibility('hidden') })
      act(() => { jest.advanceTimersByTime(CALENDAR_POLL_MS * 3) })
      expect(calendarFetchCount()).toBe(1)

      act(() => { setVisibility('visible') })
      await waitFor(() => expect(calendarFetchCount()).toBe(2))

      act(() => { jest.advanceTimersByTime(CALENDAR_POLL_MS) })
      await waitFor(() => expect(calendarFetchCount()).toBe(3))
    })

    it('does not start polling when mounted hidden and clears its interval on unmount', async () => {
      mockFetch({ status: 'connected', meetings: [] }, { ok: true, messages: [] })
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      const { unmount } = render(<TodayRail {...baseProps} />)
      await screen.findByText('No more meetings today')
      act(() => { jest.advanceTimersByTime(CALENDAR_POLL_MS * 2) })
      expect(calendarFetchCount()).toBe(1)

      act(() => { setVisibility('visible') })
      await waitFor(() => expect(calendarFetchCount()).toBe(2))

      unmount()
      act(() => { jest.advanceTimersByTime(CALENDAR_POLL_MS * 5) })
      act(() => { setVisibility('hidden') })
      act(() => { setVisibility('visible') })
      expect(calendarFetchCount()).toBe(2)
    })

    it('keeps the current chips on screen during a background reload instead of flashing the loading state', async () => {
      mockFetch(
        { status: 'connected', meetings: [{ id: 'm-1', title: 'Buhle intro', start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T08:30:00.000Z', allDay: false }] },
        { ok: true, messages: [] },
      )
      render(<TodayRail {...baseProps} />)
      await screen.findByText('Buhle intro')
      act(() => { jest.advanceTimersByTime(CALENDAR_POLL_MS) })
      expect(screen.queryByText('Loading calendar…')).not.toBeInTheDocument()
      expect(screen.getByText('Buhle intro')).toBeInTheDocument()
      await waitFor(() => expect(calendarFetchCount()).toBe(2))
    })
  })

  describe('meeting chip urgency', () => {
    it('shows "in N min" with an emphasised chip when the next meeting starts within 15 minutes', async () => {
      mockFetch(
        {
          status: 'connected',
          meetings: [
            { id: 'm-1', title: 'Buhle intro', start: '2026-09-03T07:37:30.000Z', end: '2026-09-03T08:00:00.000Z', meetUrl: 'https://meet.google.com/abc', allDay: false },
            { id: 'm-2', title: 'Roadmap', start: '2026-09-03T12:00:00.000Z', end: '2026-09-03T13:00:00.000Z', allDay: false },
          ],
        },
        { ok: true, messages: [] },
      )
      render(<TodayRail {...baseProps} />)
      const chip = await screen.findByRole('link', { name: 'Join Buhle intro in 8 min' })
      expect(chip).toHaveAttribute('data-urgency', 'soon')
      expect(chip).toHaveTextContent('in 8 min')
      expect(chip.className).toContain('border-[var(--color-pib-text)]')
      // Later meetings keep the clock time and the plain chip.
      const roadmap = screen.getByText('Roadmap').closest('[data-urgency]')
      expect(roadmap).toHaveAttribute('data-urgency', 'later')
      expect(roadmap).not.toHaveTextContent(/in \d+ min|now/)
    })

    it('shows "now" while a meeting is in progress', async () => {
      mockFetch(
        {
          status: 'connected',
          meetings: [{ id: 'm-1', title: 'Standup', start: '2026-09-03T07:20:00.000Z', end: '2026-09-03T07:50:00.000Z', meetUrl: 'https://meet.google.com/xyz', allDay: false }],
        },
        { ok: true, messages: [] },
      )
      render(<TodayRail {...baseProps} />)
      const chip = await screen.findByRole('link', { name: 'Join Standup now' })
      expect(chip).toHaveAttribute('data-urgency', 'now')
      expect(chip).toHaveTextContent('now')
    })

    it('counts down as the clock ticks', async () => {
      mockFetch(
        { status: 'connected', meetings: [{ id: 'm-1', title: 'Buhle intro', start: '2026-09-03T07:45:00.000Z', end: '2026-09-03T08:00:00.000Z', allDay: false }] },
        { ok: true, messages: [] },
      )
      render(<TodayRail {...baseProps} />)
      await screen.findByText('in 15 min')
      act(() => { jest.advanceTimersByTime(5 * 60_000) })
      await screen.findByText('in 10 min')
    })
  })

  describe('meetingTiming', () => {
    const now = Date.parse('2026-09-03T07:30:00.000Z')
    it('labels in-progress meetings "now"', () => {
      expect(meetingTiming({ start: '2026-09-03T07:29:00.000Z', end: '2026-09-03T07:31:00.000Z' }, now)).toEqual({ label: 'now', urgency: 'now' })
    })
    it('rounds up partial minutes and never shows "in 0 min"', () => {
      expect(meetingTiming({ start: '2026-09-03T07:30:10.000Z', end: '2026-09-03T07:45:00.000Z' }, now)).toEqual({ label: 'in 1 min', urgency: 'soon' })
      expect(meetingTiming({ start: '2026-09-03T07:45:00.000Z', end: '2026-09-03T08:00:00.000Z' }, now)).toEqual({ label: 'in 15 min', urgency: 'soon' })
    })
    it('falls back to the clock time beyond 15 minutes, once ended, or with no clock yet', () => {
      expect(meetingTiming({ start: '2026-09-03T07:46:00.000Z', end: '2026-09-03T08:00:00.000Z' }, now).urgency).toBe('later')
      expect(meetingTiming({ start: '2026-09-03T07:00:00.000Z', end: '2026-09-03T07:15:00.000Z' }, now).urgency).toBe('later')
      expect(meetingTiming({ start: '2026-09-03T07:31:00.000Z', end: '2026-09-03T07:45:00.000Z' }, null).urgency).toBe('later')
    })
  })

  describe('lanes-clear progress', () => {
    it('shows "N of 5 clear" and renders a check icon on zero-count lanes that stay clickable', async () => {
      mockFetch({ status: 'connected', meetings: [] }, { ok: true, messages: [] })
      const onSelectLane = jest.fn()
      render(<TodayRail {...baseProps} onSelectLane={onSelectLane} laneCounts={{ meeting: 0, reply: 4, approval: 0, agent: 2, blocked: 0 }} />)
      await screen.findByText('No more meetings today')

      expect(screen.getByTestId('lanes-clear')).toHaveTextContent('3 of 5 clear')
      expect(screen.getByTestId('lanes-clear').querySelector('[data-icon="check_circle"]')).toBeNull()

      const meetings = screen.getByRole('button', { name: /meetings/i })
      expect(meetings).not.toHaveTextContent('0')
      expect(meetings.querySelector('[data-icon="check_circle"]')).not.toBeNull()
      fireEvent.click(meetings)
      expect(onSelectLane).toHaveBeenCalledWith('meeting')

      const replies = screen.getByRole('button', { name: /replies/i })
      expect(replies).toHaveTextContent('4')
      expect(replies.querySelector('[data-icon="check_circle"]')).toBeNull()
    })

    it('shows "All clear" with a check icon when every lane is empty', async () => {
      mockFetch({ status: 'connected', meetings: [] }, { ok: true, messages: [] })
      render(<TodayRail {...baseProps} laneCounts={{ meeting: 0, reply: 0, approval: 0, agent: 0, blocked: 0 }} />)
      await screen.findByText('No more meetings today')
      const chip = screen.getByTestId('lanes-clear')
      expect(chip).toHaveTextContent('All clear')
      expect(chip).not.toHaveTextContent(/of 5/)
      expect(chip.querySelector('[data-icon="check_circle"]')).not.toBeNull()
    })

    it('shows "0 of 5 clear" when every lane has work', async () => {
      mockFetch({ status: 'connected', meetings: [] }, { ok: true, messages: [] })
      render(<TodayRail {...baseProps} />)
      await screen.findByText('No more meetings today')
      expect(screen.getByTestId('lanes-clear')).toHaveTextContent('0 of 5 clear')
    })
  })

  it('tolerates non-array payloads from the calendar and mailbox endpoints', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { id: 'ok' } }) } as Response)) as jest.Mock
    render(<TodayRail {...baseProps} />)
    expect(await screen.findByText('No more meetings today')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('link', { name: /inbox: 0 unread/i })).toBeInTheDocument())
  })
})
