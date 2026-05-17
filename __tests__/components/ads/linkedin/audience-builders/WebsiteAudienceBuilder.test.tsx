/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LinkedinWebsiteAudienceBuilder } from '@/components/ads/linkedin/audience-builders/WebsiteAudienceBuilder'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: { id: 'aud-li-1' } }),
  }) as unknown as typeof fetch
})

const onCreated = jest.fn()

describe('LinkedinWebsiteAudienceBuilder', () => {
  it('renders name, insightTagId, and 1 default rule row', () => {
    render(<LinkedinWebsiteAudienceBuilder orgId="org_1" orgSlug="acme" />)
    expect(screen.getByLabelText(/Audience name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Insight Tag ID/i)).toBeInTheDocument()
    // One rule row: match type select + URL input
    expect(screen.getByLabelText(/Rule 1 match type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Rule 1 URL/i)).toBeInTheDocument()
  })

  it('Add rule button adds another rule row', () => {
    render(<LinkedinWebsiteAudienceBuilder orgId="org_1" orgSlug="acme" />)
    const addBtn = screen.getByRole('button', { name: /Add rule/i })
    fireEvent.click(addBtn)
    expect(screen.getByLabelText(/Rule 2 match type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Rule 2 URL/i)).toBeInTheDocument()
  })

  it('submits POST with correct body shape and calls onCreated on success', async () => {
    render(
      <LinkedinWebsiteAudienceBuilder orgId="org_1" orgSlug="acme" onCreated={onCreated} />
    )

    fireEvent.change(screen.getByLabelText(/Audience name/i), {
      target: { value: 'Pricing Visitors' },
    })
    fireEvent.change(screen.getByLabelText(/Insight Tag ID/i), {
      target: { value: '9876543' },
    })
    fireEvent.change(screen.getByLabelText(/Rule 1 URL/i), {
      target: { value: 'https://example.com/pricing' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create audience/i }))
    })

    await waitFor(() => {
      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe('/api/v1/ads/custom-audiences')
      expect((opts as RequestInit).headers).toMatchObject({ 'X-Org-Id': 'org_1' })
      const body = JSON.parse((opts as RequestInit).body as string)
      expect(body.platform).toBe('linkedin')
      expect(body.type).toBe('WEBSITE')
      expect(body.name).toBe('Pricing Visitors')
      expect(body.providerData.linkedin.insightTagId).toBe('9876543')
      expect(body.providerData.linkedin.websiteRules).toEqual([
        { matchType: 'CONTAINS', url: 'https://example.com/pricing' },
      ])
    })

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('aud-li-1')
    })
  })
})
