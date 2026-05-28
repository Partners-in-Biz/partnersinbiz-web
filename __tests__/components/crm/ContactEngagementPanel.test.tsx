import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText('1 inbound')).toBeInTheDocument()
    expect(screen.getByText('3 activities')).toBeInTheDocument()
    expect(screen.getByText('Send the proposal recap')).toBeInTheDocument()
    expect(screen.getByText(/They replied after the demo/)).toBeInTheDocument()
  })
})
