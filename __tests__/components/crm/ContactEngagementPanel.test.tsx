import { fireEvent, render, screen } from '@testing-library/react'
import {
  contactEngagementHealth,
  ContactEngagementPanel,
  type ContactEngagementProfile,
} from '@/components/crm/ContactEngagementPanel'

const recentDate = new Date(Date.now() - 3 * 86_400_000).toISOString()

const profile: ContactEngagementProfile = {
  lastContactedAt: recentDate,
  emails: [
    { id: 'e1', direction: 'outbound', subject: 'Intro sent' },
    { id: 'e2', direction: 'inbound', subject: 'Re: Intro' },
  ],
  activities: [
    { id: 'a1', type: 'call', summary: 'Discovery call' },
    { id: 'a2', type: 'note', summary: 'Budget confirmed' },
    { id: 'a3', type: 'meeting_scheduled', summary: 'Demo scheduled' },
  ],
  nextSuggestion: {
    action: 'Send the proposal recap',
    reason: 'They replied after the demo and have not received a written summary.',
    urgency: 'high',
  },
}

describe('ContactEngagementPanel', () => {
  it('scores recent touch, email coverage, replies, activity depth, and next action', () => {
    expect(contactEngagementHealth(profile)).toBe(100)
    expect(contactEngagementHealth({ activities: [{ id: 'a1' }] })).toBe(20)
  })

  it('renders engagement cadence and recommended action', () => {
    render(<ContactEngagementPanel profile={profile} />)

    expect(screen.getByText('Engagement cockpit')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Warm')).toBeInTheDocument()
    expect(screen.getByText('2 emails')).toBeInTheDocument()
    expect(screen.getByText('1 inbound reply')).toBeInTheDocument()
    expect(screen.getByText('3 activities')).toBeInTheDocument()
    expect(screen.getByText('Send the proposal recap')).toBeInTheDocument()
    expect(screen.getByText(/They replied after the demo/)).toBeInTheDocument()
  })

  it('explains when no inbound replies have been captured', () => {
    render(<ContactEngagementPanel profile={{ ...profile, emails: [{ id: 'e1', direction: 'outbound', subject: 'Intro sent' }] }} />)

    expect(screen.getByText('No inbound replies')).toBeInTheDocument()
    expect(screen.queryByText('0 inbound')).not.toBeInTheDocument()
  })

  it('turns a missing suggested action into direct engagement commands', () => {
    const onLogNote = jest.fn()
    const onSendEmail = jest.fn()
    const onScheduleMeeting = jest.fn()

    render(
      <ContactEngagementPanel
        profile={{ emails: [], activities: [] }}
        actions={{
          contactName: 'Jane Client',
          onLogNote,
          onSendEmail,
          onScheduleMeeting,
        }}
      />,
    )

    expect(screen.getByText('Next best action missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create the next relationship signal' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'No AI recommendation is ready yet. Log a note, send an email, or schedule the next touch so the team has enough context to keep the relationship moving.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log note from engagement cockpit for Jane Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send email from engagement cockpit to Jane Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting from engagement cockpit with Jane Client' }))

    expect(onLogNote).toHaveBeenCalledTimes(1)
    expect(onSendEmail).toHaveBeenCalledTimes(1)
    expect(onScheduleMeeting).toHaveBeenCalledTimes(1)
  })
})
