import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ActivityTimeline } from '@/components/admin/crm/ActivityTimeline'

describe('ActivityTimeline', () => {
  it('turns an empty activity history into a first-note action', () => {
    const onAddNote = jest.fn()

    render(<ActivityTimeline activities={[]} loading={false} onAddNote={onAddNote} />)

    fireEvent.click(screen.getByRole('button', { name: 'Log first note from activity timeline' }))

    expect(onAddNote).toHaveBeenCalledTimes(1)
  })
})
