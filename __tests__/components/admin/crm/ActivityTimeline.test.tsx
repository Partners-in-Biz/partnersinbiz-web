import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ActivityTimeline } from '@/components/admin/crm/ActivityTimeline'

describe('ActivityTimeline', () => {
  it('turns an empty activity history into a relationship history command state', () => {
    const onAddNote = jest.fn()

    render(<ActivityTimeline activities={[]} loading={false} contactName="Ava Owner" onAddNote={onAddNote} />)

    expect(screen.getByText('Relationship history missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "Start Ava Owner's activity trail" })).toBeInTheDocument()
    expect(
      screen.getByText(
        'No emails, calls, notes, stage changes, or sequence events are captured yet. Log the first note so managers can see ownership, context, and the next handoff.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log first activity note for Ava Owner' }))

    expect(onAddNote).toHaveBeenCalledTimes(1)
  })

  it('renders activity rows with readable labels when snapshots are incomplete', () => {
    render(
      <ActivityTimeline
        activities={[
          {
            id: 'activity-1',
            type: 'meeting_follow_up',
            summary: '',
            createdAt: { seconds: Number.NaN },
          },
        ]}
        loading={false}
        contactName="Ava Owner"
      />,
    )

    expect(screen.getByText(/Meeting follow up/)).toBeInTheDocument()
    expect(screen.getByText(/Activity date needs review/)).toBeInTheDocument()
    expect(screen.getByText('Activity summary missing')).toBeInTheDocument()
    expect(screen.queryByText(/meeting_follow_up/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument()
  })
})
