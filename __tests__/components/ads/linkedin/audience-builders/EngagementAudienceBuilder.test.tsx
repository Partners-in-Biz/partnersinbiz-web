/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LinkedinEngagementAudienceBuilder } from '@/components/ads/linkedin/audience-builders/EngagementAudienceBuilder'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: { id: 'aud-li-2' } }),
  }) as unknown as typeof fetch
})

describe('LinkedinEngagementAudienceBuilder', () => {
  it('renders engagementType select with 3 enum options', () => {
    render(<LinkedinEngagementAudienceBuilder orgId="org_1" orgSlug="acme" />)
    const select = screen.getByLabelText(/Engagement type/i)
    expect(select).toBeInTheDocument()
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toContain('VISITORS')
    expect(options).toContain('FOLLOWERS')
    expect(options).toContain('VIDEO_VIEWERS')
    expect(options).toHaveLength(3)
  })

  it('submits POST with providerData.linkedin.{organizationUrn, engagementType}', async () => {
    const onCreated = jest.fn()
    render(
      <LinkedinEngagementAudienceBuilder orgId="org_1" orgSlug="acme" onCreated={onCreated} />
    )

    fireEvent.change(screen.getByLabelText(/Audience name/i), {
      target: { value: 'Company Followers' },
    })
    fireEvent.change(screen.getByLabelText(/Organization URN/i), {
      target: { value: 'urn:li:organization:12345678' },
    })
    fireEvent.change(screen.getByLabelText(/Engagement type/i), {
      target: { value: 'FOLLOWERS' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create audience/i }))
    })

    await waitFor(() => {
      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe('/api/v1/ads/custom-audiences')
      const body = JSON.parse((opts as RequestInit).body as string)
      expect(body.platform).toBe('linkedin')
      expect(body.type).toBe('ENGAGEMENT')
      expect(body.name).toBe('Company Followers')
      expect(body.providerData.linkedin.organizationUrn).toBe('urn:li:organization:12345678')
      expect(body.providerData.linkedin.engagementType).toBe('FOLLOWERS')
    })

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('aud-li-2')
    })
  })
})
