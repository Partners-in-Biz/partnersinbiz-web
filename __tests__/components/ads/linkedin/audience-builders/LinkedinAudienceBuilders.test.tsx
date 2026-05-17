/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LinkedinAudienceBuilders } from '@/app/(admin)/admin/org/[slug]/ads/audiences/LinkedinAudienceBuilders'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: [] }),
  }) as unknown as typeof fetch
})

const defaultProps = { orgId: 'org_1', orgSlug: 'acme' }

describe('LinkedinAudienceBuilders', () => {
  it('renders 5-tile subtype picker on initial mount', () => {
    render(<LinkedinAudienceBuilders {...defaultProps} />)
    expect(screen.getByText('Customer List')).toBeInTheDocument()
    expect(screen.getByText('Website')).toBeInTheDocument()
    expect(screen.getByText('Lookalike')).toBeInTheDocument()
    expect(screen.getByText('Engagement')).toBeInTheDocument()
    expect(screen.getByText('App')).toBeInTheDocument()
  })

  it('selecting "Customer List" tile renders ContactListBuilder', () => {
    render(<LinkedinAudienceBuilders {...defaultProps} />)
    fireEvent.click(screen.getByText('Customer List'))
    expect(screen.getByLabelText(/Audience name/i)).toBeInTheDocument()
    // ContactListBuilder shows an upload note
    expect(screen.getByText(/upload/i)).toBeInTheDocument()
  })

  it('selecting "Website" tile renders WebsiteAudienceBuilder', () => {
    render(<LinkedinAudienceBuilders {...defaultProps} />)
    fireEvent.click(screen.getByText('Website'))
    expect(screen.getByLabelText(/Insight Tag ID/i)).toBeInTheDocument()
  })

  it('selecting "Lookalike" tile renders LookalikeAudienceBuilder', () => {
    render(<LinkedinAudienceBuilders {...defaultProps} />)
    fireEvent.click(screen.getByText('Lookalike'))
    // LookalikeBuilder has source segment label
    expect(screen.getByText(/Source segment/i)).toBeInTheDocument()
  })

  it('selecting "Engagement" tile renders EngagementAudienceBuilder', () => {
    render(<LinkedinAudienceBuilders {...defaultProps} />)
    fireEvent.click(screen.getByText('Engagement'))
    expect(screen.getByLabelText(/Organization URN/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Engagement type/i)).toBeInTheDocument()
  })

  it('selecting "App" tile renders AppAudienceInfoCard with workaround text', () => {
    render(<LinkedinAudienceBuilders {...defaultProps} />)
    fireEvent.click(screen.getByText('App'))
    expect(screen.getByText(/App audiences on LinkedIn/i)).toBeInTheDocument()
    expect(screen.getByText(/does not offer a native App audience/i)).toBeInTheDocument()
    expect(screen.getByText(/Create Customer List instead/i)).toBeInTheDocument()
  })
})
