import { render, screen } from '@testing-library/react'
import {
  contactOwnershipHealth,
  ContactOwnershipPanel,
  type ContactOwnershipProfile,
} from '@/components/crm/ContactOwnershipPanel'

const profile: ContactOwnershipProfile = {
  assignedTo: 'uid-owner',
  assignedToRef: { uid: 'uid-owner', displayName: 'Ava Owner', email: 'ava@example.com', kind: 'human' },
  source: 'outreach',
  capturedFromId: 'source-1',
  createdByRef: { uid: 'uid-creator', displayName: 'Pip Agent', kind: 'agent' },
  updatedByRef: { uid: 'uid-updater', displayName: 'Peet Stander', kind: 'human' },
}

describe('ContactOwnershipPanel', () => {
  it('scores owner, source, capture, creator, and updater governance signals', () => {
    expect(contactOwnershipHealth(profile)).toBe(100)
    expect(contactOwnershipHealth({ source: 'manual' })).toBe(20)
  })

  it('renders relationship owner and governance details', () => {
    render(<ContactOwnershipPanel profile={profile} />)

    expect(screen.getByText('Relationship ownership')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Ava Owner')).toBeInTheDocument()
    expect(screen.getByText('outreach')).toBeInTheDocument()
    expect(screen.getByText('source-1')).toBeInTheDocument()
    expect(screen.getByText('Pip Agent')).toBeInTheDocument()
    expect(screen.getByText('Peet Stander')).toBeInTheDocument()
  })
})
