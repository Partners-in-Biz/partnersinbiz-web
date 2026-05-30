import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByText('Outreach')).toBeInTheDocument()
    expect(screen.queryByText('outreach')).not.toBeInTheDocument()
    expect(screen.getByText('Source 1')).toBeInTheDocument()
    expect(screen.queryByText('source-1')).not.toBeInTheDocument()
    expect(screen.getByText('Pip Agent')).toBeInTheDocument()
    expect(screen.getByText('Peet Stander')).toBeInTheDocument()
    expect(screen.getAllByText('Team member')).toHaveLength(2)
    expect(screen.getByText('AI agent')).toBeInTheDocument()
    expect(screen.queryByText('human')).not.toBeInTheDocument()
    expect(screen.queryByText('agent')).not.toBeInTheDocument()
  })

  it('formats unknown CRM source ids as readable provenance labels', () => {
    render(
      <ContactOwnershipPanel
        profile={{
          ...profile,
          source: 'linkedin_ads',
          capturedFromId: 'campaign-42',
        }}
      />,
    )

    expect(screen.getByText('Linkedin Ads')).toBeInTheDocument()
    expect(screen.queryByText('linkedin_ads')).not.toBeInTheDocument()
  })

  it('formats unknown member kinds as readable governance labels', () => {
    render(
      <ContactOwnershipPanel
        profile={{
          ...profile,
          assignedToRef: {
            uid: 'partner-1',
            displayName: 'External Partner',
            kind: 'external_partner',
          },
        }}
      />,
    )

    expect(screen.getAllByText('External Partner').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('external_partner')).not.toBeInTheDocument()
  })

  it('formats capture source ids as readable provenance labels', () => {
    render(
      <ContactOwnershipPanel
        profile={{
          ...profile,
          capturedFromId: 'facebook_lead_form',
        }}
      />,
    )

    expect(screen.getByText('Facebook Lead Form')).toBeInTheDocument()
    expect(screen.queryByText('facebook_lead_form')).not.toBeInTheDocument()
  })

  it('turns a missing relationship owner into an accountability assignment action', () => {
    const assignOwner = jest.fn()

    render(
      <ContactOwnershipPanel
        profile={{
          source: 'manual',
          capturedFromId: 'crm-import',
          createdByRef: { uid: 'uid-creator', displayName: 'Pip Agent', kind: 'agent' },
        }}
        actions={{
          assignOwner: {
            label: 'Assign owner',
            ariaLabel: 'Assign owner for Jane Client from relationship ownership',
            onClick: assignOwner,
          },
        }}
      />,
    )

    expect(screen.getByText('Owner accountability missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assign a relationship owner' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'No team member owns this contact yet. Assign an owner so follow-ups, handoffs, and pipeline accountability are visible before the relationship goes cold.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Jane Client from relationship ownership' }))

    expect(assignOwner).toHaveBeenCalledTimes(1)
  })

  it('turns weak source provenance into a source review action', () => {
    const reviewSource = jest.fn()

    render(
      <ContactOwnershipPanel
        profile={{
          assignedTo: 'uid-owner',
          assignedToRef: { uid: 'uid-owner', displayName: 'Ava Owner', kind: 'human' },
          source: 'manual',
          createdByRef: { uid: 'uid-creator', displayName: 'Pip Agent', kind: 'agent' },
        }}
        actions={{
          reviewSource: {
            label: 'Review source',
            ariaLabel: 'Review source provenance for Jane Client from relationship ownership',
            onClick: reviewSource,
          },
        }}
      />,
    )

    expect(screen.getByText('Source provenance weak')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Confirm how this contact entered CRM' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This relationship is marked as manual or legacy without a capture source. Review the source so attribution, segment reporting, and follow-up ownership stay trustworthy.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review source provenance for Jane Client from relationship ownership' }))

    expect(reviewSource).toHaveBeenCalledTimes(1)
  })
})
