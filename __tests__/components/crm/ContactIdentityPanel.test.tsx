import { render, screen } from '@testing-library/react'
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
})
