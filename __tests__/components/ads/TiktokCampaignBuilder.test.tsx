/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TiktokCampaignBuilder } from '@/components/ads/TiktokCampaignBuilder'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

const MOCK_IDENTITIES = [
  { identityId: 'ident_001', identityType: 'TT_USER', displayName: 'Acme TikTok' },
  { identityId: 'ident_002', identityType: 'AUTH_CODE', displayName: 'Acme Brand' },
]

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { id: 'mock_id' } }),
  }) as unknown as typeof fetch
})

describe('TiktokCampaignBuilder', () => {
  it('renders Step 1 with campaign name and objective inputs', () => {
    render(<TiktokCampaignBuilder orgId="org_1" orgSlug="acme" />)

    expect(screen.getByText(/1\. Campaign/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Campaign name')).toBeInTheDocument()
    // Objectives
    expect(screen.getByText('Traffic')).toBeInTheDocument()
    expect(screen.getByText('Leads')).toBeInTheDocument()
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('Awareness')).toBeInTheDocument()
    expect(screen.getByText('Engagement')).toBeInTheDocument()
  })

  it('advances to Step 2 on Next and shows targeting editor', () => {
    render(<TiktokCampaignBuilder orgId="org_1" orgSlug="acme" />)

    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'My TikTok Campaign' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    expect(screen.getByText(/2\. AdGroup/i)).toBeInTheDocument()
    expect(screen.getByLabelText('AdGroup name')).toBeInTheDocument()
    // Targeting editor controls
    expect(screen.getByLabelText('Locations')).toBeInTheDocument()
    // Age group checkboxes
    expect(screen.getByLabelText('AGE_18_24')).toBeInTheDocument()
    expect(screen.getByLabelText('AGE_25_34')).toBeInTheDocument()
  })

  it('Step 3 fetches identities on mount and shows them in picker', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/v1/ads/tiktok/identities') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { identities: MOCK_IDENTITIES },
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { id: 'mock_id' } }),
      })
    })

    render(<TiktokCampaignBuilder orgId="org_1" orgSlug="acme" />)

    // Navigate to Step 2
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'TikTok Identities Test' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Navigate to Step 3
    fireEvent.change(screen.getByLabelText('AdGroup name'), {
      target: { value: 'Test AdGroup' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Identity picker should appear with fetched identities
    await waitFor(() => {
      expect(screen.getByLabelText('TikTok identity')).toBeInTheDocument()
    })

    expect(screen.getByText('Acme TikTok (ident_001)')).toBeInTheDocument()
    expect(screen.getByText('Acme Brand (ident_002)')).toBeInTheDocument()

    // Verify fetch was called for identities
    const calls = (global.fetch as jest.Mock).mock.calls
    const identitiesCall = calls.find((c: string[]) => c[0] === '/api/v1/ads/tiktok/identities')
    expect(identitiesCall).toBeDefined()
  })

  it('final submit fires 3 POSTs in order and calls onComplete with {campaignId, adSetId, adId}', async () => {
    const onComplete = jest.fn()
    ;(global.fetch as jest.Mock)
      .mockImplementation((url: string) => {
        if (url === '/api/v1/ads/tiktok/identities') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: { identities: MOCK_IDENTITIES },
            }),
          })
        }
        if (url === '/api/v1/ads/campaigns') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, data: { id: 'cmp_tk_1' } }),
          })
        }
        if (url === '/api/v1/ads/ad-sets') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, data: { id: 'adset_tk_1' } }),
          })
        }
        if (url === '/api/v1/ads/ads') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, data: { id: 'ad_tk_1' } }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { id: 'fallback' } }),
        })
      })

    render(<TiktokCampaignBuilder orgId="org_1" orgSlug="acme" onComplete={onComplete} />)

    // Step 1
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'TK Campaign Submit' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Step 2
    fireEvent.change(screen.getByLabelText('AdGroup name'), {
      target: { value: 'TK AdGroup Submit' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Step 3 — wait for identities to load
    await waitFor(() => {
      expect(screen.getByLabelText('TikTok identity')).toBeInTheDocument()
    })

    // Select identity
    fireEvent.change(screen.getByLabelText('TikTok identity'), {
      target: { value: 'ident_001' },
    })

    // Fill required fields
    fireEvent.change(screen.getByLabelText('Ad name'), {
      target: { value: 'TK Hero Ad' },
    })
    fireEvent.change(screen.getByLabelText('Ad text'), {
      target: { value: 'Check out our new product!' },
    })
    fireEvent.change(screen.getByLabelText('Landing page URL'), {
      target: { value: 'https://example.com/landing' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create campaign/i }))
    })

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        campaignId: 'cmp_tk_1',
        adSetId: 'adset_tk_1',
        adId: 'ad_tk_1',
      })
    })

    // Verify 3 sequential POSTs were made (plus the identities GET)
    const postCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: string[]) => c[0] !== '/api/v1/ads/tiktok/identities'
    )
    expect(postCalls).toHaveLength(3)

    // Campaign call
    expect(postCalls[0][0]).toBe('/api/v1/ads/campaigns')
    const campaignBody = JSON.parse((postCalls[0][1] as RequestInit).body as string)
    expect(campaignBody.platform).toBe('tiktok')
    expect(campaignBody.input.name).toBe('TK Campaign Submit')

    // AdSet call
    expect(postCalls[1][0]).toBe('/api/v1/ads/ad-sets')
    const adSetBody = JSON.parse((postCalls[1][1] as RequestInit).body as string)
    expect(adSetBody.platform).toBe('tiktok')
    expect(adSetBody.input.campaignId).toBe('cmp_tk_1')
    expect(adSetBody.input.name).toBe('TK AdGroup Submit')

    // Ad call
    expect(postCalls[2][0]).toBe('/api/v1/ads/ads')
    const adBody = JSON.parse((postCalls[2][1] as RequestInit).body as string)
    expect(adBody.platform).toBe('tiktok')
    expect(adBody.tiktokAds.identityId).toBe('ident_001')
    expect(adBody.tiktokAds.adText).toBe('Check out our new product!')
  })
})
