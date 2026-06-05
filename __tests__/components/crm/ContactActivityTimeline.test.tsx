import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ContactActivityTimeline } from '@/components/crm/ContactActivityTimeline'

describe('ContactActivityTimeline', () => {
  it('turns an empty activity history into a relationship activity command state', () => {
    const onAddNote = jest.fn()

    render(<ContactActivityTimeline activities={[]} loading={false} contactName="Ava Owner" onAddNote={onAddNote} />)

    expect(screen.getByText('Relationship activity missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "Start Ava Owner's activity trail" })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Log the first note, call, email, or meeting so the whole team can see what happened, who followed up, and what should happen next.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log first activity note for Ava Owner' }))

    expect(onAddNote).toHaveBeenCalledTimes(1)
  })

  it('renders activity rows with readable labels when snapshots are incomplete', () => {
    render(
      <ContactActivityTimeline
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

  it('keeps portal continuation and pagination actions reusable', () => {
    const onContinueActivity = jest.fn()
    const onLoadMore = jest.fn()

    render(
      <ContactActivityTimeline
        activities={[{ id: 'activity-1', type: 'note', summary: 'Follow up on launch', createdAt: { _seconds: 1 } }]}
        loading={false}
        contactName="Ava Owner"
        onContinueActivity={onContinueActivity}
        hasMore
        onLoadMore={onLoadMore}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue from activity Follow up on launch with Ava Owner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load more activity for Ava Owner' }))

    expect(onContinueActivity).toHaveBeenCalledWith(expect.objectContaining({ id: 'activity-1' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
