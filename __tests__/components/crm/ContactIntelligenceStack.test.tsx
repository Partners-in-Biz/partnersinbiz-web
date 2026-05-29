import { render, screen } from '@testing-library/react'
import {
  ContactIntelligenceStack,
  type ContactIntelligenceStackContact,
} from '@/components/crm/ContactIntelligenceStack'

const contact: ContactIntelligenceStackContact = {
  assignedTo: 'uid-owner',
  assignedToRef: { uid: 'uid-owner', displayName: 'Ava Owner', kind: 'human' },
  source: 'outreach',
  capturedFromId: 'source-1',
  createdByRef: { uid: 'agent:pip', displayName: 'Pip', kind: 'agent' },
  updatedByRef: { uid: 'uid-peet', displayName: 'Peet Stander', kind: 'human' },
  jobTitle: 'Finance Director',
  department: 'Finance',
  timezone: 'Africa/Johannesburg',
  phoneVerified: true,
  smsOptedIn: true,
  repliesCount: 2,
  lastContactedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
}

describe('ContactIntelligenceStack', () => {
  it('renders identity, ownership, and engagement intelligence together', () => {
    render(
      <ContactIntelligenceStack
        contact={contact}
        emails={[
          { id: 'e1', direction: 'outbound', subject: 'Intro' },
          { id: 'e2', direction: 'inbound', subject: 'Re: Intro' },
        ]}
        activities={[{ id: 'a1', type: 'call', summary: 'Discovery call' }]}
        nextSuggestion={{
          action: 'Send the proposal recap',
          reason: 'They replied after the demo.',
          urgency: 'high',
        }}
      />,
    )

    expect(screen.getByText('Identity intelligence')).toBeInTheDocument()
    expect(screen.getByText('Relationship ownership')).toBeInTheDocument()
    expect(screen.getByText('Engagement cockpit')).toBeInTheDocument()
    expect(screen.getByText('Finance Director')).toBeInTheDocument()
    expect(screen.getByText('Ava Owner')).toBeInTheDocument()
    expect(screen.getByText('Send the proposal recap')).toBeInTheDocument()
  })
})
