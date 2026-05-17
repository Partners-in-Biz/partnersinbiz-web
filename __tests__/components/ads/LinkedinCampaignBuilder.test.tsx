/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LinkedinCampaignBuilder } from '@/components/ads/LinkedinCampaignBuilder'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
}))

beforeEach(() => {
  mockPush.mockClear()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { id: 'c1' } }),
  }) as unknown as typeof fetch
})

describe('LinkedinCampaignBuilder', () => {
  it('renders Step 1 with campaign group name and objective inputs', () => {
    render(<LinkedinCampaignBuilder orgId="org_1" orgSlug="acme" />)

    expect(screen.getByText(/1\. Campaign Group/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Campaign group name')).toBeInTheDocument()
    // Objective options
    expect(screen.getByText('Awareness')).toBeInTheDocument()
    expect(screen.getByText('Traffic')).toBeInTheDocument()
    expect(screen.getByText('Leads')).toBeInTheDocument()
  })

  it('advances to Step 2 on Next and shows targeting editor', () => {
    render(<LinkedinCampaignBuilder orgId="org_1" orgSlug="acme" />)

    fireEvent.change(screen.getByLabelText('Campaign group name'), {
      target: { value: 'Brand Campaign Group' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    expect(screen.getByText(/2\. Campaign/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Campaign name')).toBeInTheDocument()
    // Targeting editor present
    expect(screen.getByLabelText('Locations (ISO country codes)')).toBeInTheDocument()
  })

  it('submits the 3-API-call sequence on final step and calls onComplete', async () => {
    const onComplete = jest.fn()
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'cmp_li_1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'adset_li_1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'ad_li_1' } }),
      })

    render(<LinkedinCampaignBuilder orgId="org_1" orgSlug="acme" onComplete={onComplete} />)

    // Step 1
    fireEvent.change(screen.getByLabelText('Campaign group name'), {
      target: { value: 'My LI Campaign Group' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Step 2
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'LI Campaign Jan' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Step 3
    fireEvent.change(screen.getByLabelText('Creative name'), {
      target: { value: 'Hero Creative' },
    })
    fireEvent.change(screen.getByLabelText('Reference URN'), {
      target: { value: 'urn:li:share:123456789' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create campaign/i }))
    })

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        campaignId: 'cmp_li_1',
        adSetId: 'adset_li_1',
        adId: 'ad_li_1',
      })
    })

    const calls = (global.fetch as jest.Mock).mock.calls
    expect(calls).toHaveLength(3)

    // Campaign call
    expect(calls[0][0]).toBe('/api/v1/ads/campaigns')
    const campaignBody = JSON.parse((calls[0][1] as RequestInit).body as string)
    expect(campaignBody.platform).toBe('linkedin')
    expect(campaignBody.input.name).toBe('My LI Campaign Group')

    // Ad-set call
    expect(calls[1][0]).toBe('/api/v1/ads/ad-sets')
    const adSetBody = JSON.parse((calls[1][1] as RequestInit).body as string)
    expect(adSetBody.platform).toBe('linkedin')
    expect(adSetBody.input.campaignId).toBe('cmp_li_1')
    expect(adSetBody.input.name).toBe('LI Campaign Jan')

    // Ad call
    expect(calls[2][0]).toBe('/api/v1/ads/ads')
    const adBody = JSON.parse((calls[2][1] as RequestInit).body as string)
    expect(adBody.platform).toBe('linkedin')
    expect(adBody.linkedinAds.referenceUrn).toBe('urn:li:share:123456789')
  })

  it('surfaces error from a failed step and does not call onComplete', async () => {
    const onComplete = jest.fn()
    ;(global.fetch as jest.Mock)
      // campaign — success
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'cmp_li_1' } }),
      })
      // ad-sets — failure
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, error: 'oops' }),
      })

    render(<LinkedinCampaignBuilder orgId="org_1" orgSlug="acme" onComplete={onComplete} />)

    // Step 1
    fireEvent.change(screen.getByLabelText('Campaign group name'), {
      target: { value: 'Error Group' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Step 2
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Error Campaign' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Step 3
    fireEvent.change(screen.getByLabelText('Creative name'), {
      target: { value: 'Error Creative' },
    })
    fireEvent.change(screen.getByLabelText('Reference URN'), {
      target: { value: 'urn:li:share:999' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create campaign/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/oops/i)).toBeInTheDocument()
    })

    expect(onComplete).not.toHaveBeenCalled()
  })
})
