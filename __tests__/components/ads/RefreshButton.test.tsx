/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { RefreshButton } from '@/components/ads/RefreshButton'

const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { enqueued: true } }),
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.useRealTimers()
})

describe('RefreshButton', () => {
  it('renders in idle state with correct label', () => {
    render(
      <RefreshButton orgId="org_123" level="campaign" pibEntityId="camp_abc" />
    )
    const btn = screen.getByRole('button', { name: /Refresh insights/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })

  it('POSTs to /api/v1/ads/insights/refresh with correct body and X-Org-Id header', async () => {
    render(
      <RefreshButton orgId="org_123" level="adset" pibEntityId="adset_xyz" />
    )
    fireEvent.click(screen.getByRole('button', { name: /Refresh insights/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/ads/insights/refresh')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Org-Id']).toBe('org_123')
    const parsedBody = JSON.parse(init.body as string)
    expect(parsedBody).toEqual({ level: 'adset', pibEntityId: 'adset_xyz' })
  })

  it('shows inline success feedback when the refresh is queued', async () => {
    render(
      <RefreshButton orgId="org_123" level="campaign" pibEntityId="camp_abc" />
    )

    fireEvent.click(screen.getByRole('button', { name: /Refresh insights/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('Insights refresh queued.')
  })

  it('shows inline failure feedback instead of a native alert', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Queue unavailable' }),
    }) as unknown as typeof fetch

    render(
      <RefreshButton orgId="org_123" level="campaign" pibEntityId="camp_abc" />
    )

    fireEvent.click(screen.getByRole('button', { name: /Refresh insights/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Queue unavailable')
    expect(alertSpy).not.toHaveBeenCalled()
  })
})
