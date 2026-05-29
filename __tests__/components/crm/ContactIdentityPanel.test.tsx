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

    expect(screen.getAllByText('Not captured')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Add role for Jane Client from identity intelligence' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add department for Jane Client from identity intelligence' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add timezone for Jane Client from identity intelligence' }))

    expect(onAddRole).toHaveBeenCalledTimes(1)
    expect(onAddDepartment).toHaveBeenCalledTimes(1)
    expect(onAddTimezone).toHaveBeenCalledTimes(1)
  })
})
