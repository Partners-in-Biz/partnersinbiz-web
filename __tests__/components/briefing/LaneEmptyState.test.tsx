import { render, screen } from '@testing-library/react'
import { LaneEmptyState, laneEmptyCopy } from '@/components/briefing/cockpit/LaneEmptyState'
import { BRIEFING_WORK_KINDS, BRIEFING_WORK_LANES, type BriefingWorkKind } from '@/lib/briefing/workKind'

jest.mock('@/components/studio', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

const EXPECTED: Record<BriefingWorkKind, { title: string; body: string }> = {
  meeting: { title: 'No calls to prepare', body: 'Booked calls and meeting prep land here.' },
  reply: { title: 'Inbox is clear', body: 'Emails, social DMs, tickets and forms waiting on you land here.' },
  approval: { title: 'Nothing to approve', body: 'Posts, documents, quotes and agent output waiting for sign-off land here.' },
  agent: { title: 'Agents are quiet', body: 'Running and queued agent work lands here.' },
  blocked: { title: 'Nothing is blocked', body: 'Stuck tasks, failed runs and overdue items land here.' },
}

describe('laneEmptyCopy', () => {
  it.each(BRIEFING_WORK_KINDS)('returns kind-specific copy for %s', (kind) => {
    expect(laneEmptyCopy(kind)).toEqual(EXPECTED[kind])
  })

  it('falls back to the reply copy for an unknown kind', () => {
    expect(laneEmptyCopy('nonsense' as BriefingWorkKind)).toEqual(EXPECTED.reply)
  })
})

describe('LaneEmptyState', () => {
  it.each(BRIEFING_WORK_LANES.map((lane) => lane.id))('renders a status region with the %s lane icon and copy', (kind) => {
    render(<LaneEmptyState kind={kind} />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('data-testid', 'lane-empty-state')
    expect(status).toHaveAttribute('data-work-kind', kind)
    expect(status).toHaveTextContent(EXPECTED[kind].title)
    expect(status).toHaveTextContent(EXPECTED[kind].body)
    const lane = BRIEFING_WORK_LANES.find((entry) => entry.id === kind)!
    expect(status.querySelector(`[data-icon="${lane.icon}"]`)).not.toBeNull()
  })
})
