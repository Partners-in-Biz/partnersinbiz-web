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
})
