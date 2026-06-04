import { fireEvent, render, screen } from '@testing-library/react'
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

  it('passes operational actions into the intelligence panels', () => {
    const onLogNote = jest.fn()
    const onSendEmail = jest.fn()
    const onStartSuggestion = jest.fn()
    const onEditProfile = jest.fn()
    const onAssignOwner = jest.fn()

    render(
      <ContactIntelligenceStack
        contact={{
          ...contact,
          assignedTo: '',
          assignedToRef: undefined,
          jobTitle: '',
          department: '',
          timezone: '',
        }}
        emails={[
          { id: 'e1', direction: 'outbound', subject: 'Intro' },
        ]}
        activities={[{ id: 'a1', type: 'note', summary: 'Discovery note' }]}
        nextSuggestion={{
          action: 'Send the proposal recap',
          reason: 'They replied after the demo.',
          urgency: 'high',
        }}
        actions={{
          contactName: 'Jane Client',
          onLogNote,
          onSendEmail,
          onStartSuggestion,
          identity: {
            jobTitle: {
              label: 'Add role',
              ariaLabel: 'Add role for Jane Client from admin intelligence stack',
              onClick: onEditProfile,
            },
          },
          ownership: {
            assignOwner: {
              label: 'Assign owner',
              ariaLabel: 'Assign owner for Jane Client from admin intelligence stack',
              onClick: onAssignOwner,
            },
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start suggested action: Send the proposal recap for Jane Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Log note from engagement cockpit for Jane Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send email from engagement cockpit to Jane Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add role for Jane Client from admin intelligence stack' }))
    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Jane Client from admin intelligence stack' }))

    expect(onStartSuggestion).toHaveBeenCalledWith({
      action: 'Send the proposal recap',
      reason: 'They replied after the demo.',
      urgency: 'high',
    })
    expect(onLogNote).toHaveBeenCalledTimes(1)
    expect(onSendEmail).toHaveBeenCalledTimes(1)
    expect(onEditProfile).toHaveBeenCalledTimes(1)
    expect(onAssignOwner).toHaveBeenCalledTimes(1)
  })
})
