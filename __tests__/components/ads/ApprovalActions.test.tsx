/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AdCampaignReviewActions } from '@/components/ads/AdCampaignReviewActions'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: {} }),
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('AdCampaignReviewActions', () => {
  it('renders Approve + Request changes buttons', () => {
    render(<AdCampaignReviewActions campaignId="camp-1" />)
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument()
  })

  it('POSTs to /approve when Approve is clicked', async () => {
    render(<AdCampaignReviewActions campaignId="camp-1" />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/ads/campaigns/camp-1/approve',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('carries the selected company org into approve requests', async () => {
    render(<AdCampaignReviewActions campaignId="camp-1" orgId="lumen-org" />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/ads/campaigns/camp-1/approve?orgId=lumen-org',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
