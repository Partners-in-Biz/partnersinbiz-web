import { fireEvent, render, screen } from '@testing-library/react'
import {
  contactIdentityHealth,
  ContactIdentityPanel,
  type ContactIdentityProfile,
} from '@/components/crm/ContactIdentityPanel'

const profile: ContactIdentityProfile = {
  jobTitle: 'Finance Director',
  department: 'Finance',
  timezone: 'Africa/Johannesburg',
  phoneVerified: true,
  smsOptedIn: true,
  unsubscribedAt: null,
  bouncedAt: null,
  repliesCount: 3,
}

describe('ContactIdentityPanel', () => {
  it('scores role, timezone, phone, messaging, subscription, and reply signals', () => {
    expect(contactIdentityHealth(profile)).toBe(100)
    expect(contactIdentityHealth({ ...profile, jobTitle: '', department: '', phoneVerified: false, smsOptedIn: false, unsubscribedAt: 'now', repliesCount: 0 })).toBe(14)
  })

  it('renders relationship intelligence details for contact detail', () => {
    render(<ContactIdentityPanel profile={profile} />)

    expect(screen.getByText('Identity intelligence')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Finance Director')).toBeInTheDocument()
    expect(screen.getByText('Finance')).toBeInTheDocument()
    expect(screen.getByText('Africa/Johannesburg')).toBeInTheDocument()
    expect(screen.getByText('SMS ready')).toBeInTheDocument()
    expect(screen.getByText('3 replies')).toBeInTheDocument()
  })

  it('explains why email reachability is blocked', () => {
    const { rerender } = render(<ContactIdentityPanel profile={{ ...profile, unsubscribedAt: '2026-05-30' }} />)

    expect(screen.getByText('Email unsubscribed')).toBeInTheDocument()
    expect(screen.queryByText('Email blocked')).not.toBeInTheDocument()

    rerender(<ContactIdentityPanel profile={{ ...profile, unsubscribedAt: null, bouncedAt: '2026-05-30' }} />)

    expect(screen.getByText('Email bounced')).toBeInTheDocument()
    expect(screen.queryByText('Email blocked')).not.toBeInTheDocument()
  })

  it('explains why SMS readiness is incomplete', () => {
    const { rerender } = render(<ContactIdentityPanel profile={{ ...profile, phoneVerified: false }} />)

    expect(screen.getByText('Phone unverified')).toBeInTheDocument()
    expect(screen.queryByText('SMS incomplete')).not.toBeInTheDocument()

    rerender(<ContactIdentityPanel profile={{ ...profile, phoneVerified: true, smsOptedIn: false }} />)

    expect(screen.getByText('SMS opted out')).toBeInTheDocument()
    expect(screen.queryByText('SMS incomplete')).not.toBeInTheDocument()
  })

  it('explains when no relationship replies have been captured', () => {
    render(<ContactIdentityPanel profile={{ ...profile, repliesCount: 0 }} />)

    expect(screen.getByText('No replies yet')).toBeInTheDocument()
    expect(screen.queryByText('0 replies')).not.toBeInTheDocument()
  })

  it('turns missing identity fields into supplied profile actions', () => {
    const onAddRole = jest.fn()
    const onAddDepartment = jest.fn()
    const onAddTimezone = jest.fn()

    render(
      <ContactIdentityPanel
        profile={{}}
        fieldActions={{
          jobTitle: {
            label: 'Add role',
            ariaLabel: 'Add role for Jane Client from identity intelligence',
            onClick: onAddRole,
          },
          department: {
            label: 'Add department',
            ariaLabel: 'Add department for Jane Client from identity intelligence',
            onClick: onAddDepartment,
          },
          timezone: {
            label: 'Add timezone',
            ariaLabel: 'Add timezone for Jane Client from identity intelligence',
            onClick: onAddTimezone,
          },
        }}
      />,
    )

    expect(screen.getByText('Personalization context missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Capture role, department, and timezone' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Add these fields so every employee can tailor outreach, meeting times, and handoffs around who this contact is and how they work.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add role for Jane Client from identity intelligence' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add department for Jane Client from identity intelligence' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add timezone for Jane Client from identity intelligence' }))

    expect(onAddRole).toHaveBeenCalledTimes(1)
    expect(onAddDepartment).toHaveBeenCalledTimes(1)
    expect(onAddTimezone).toHaveBeenCalledTimes(1)
  })
})
