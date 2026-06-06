import React from 'react'
import { render, screen } from '@testing-library/react'
import PortalBroadcastAnalyticsPage from '@/app/(portal)/portal/email-analytics/broadcasts/[id]/page'

jest.mock('@/components/email-analytics/charts', () => ({
  BarChart: () => <div data-testid="bar-chart" />,
  CountBar: ({ label }: { label: string }) => <div data-testid="count-bar">{label}</div>,
  LineChart: () => <div data-testid="line-chart" />,
}))

const fetchMock = jest.fn()

beforeAll(() => {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    value: fetchMock,
  })
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/heatmap')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              totalClicks: 1,
              linkStats: [
                {
                  url: 'https://lumen.example/book',
                  clicks: 1,
                  percentOfTotalClicks: 1,
                  positionInEmail: 1,
                },
              ],
            },
          }),
      })
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            broadcastId: 'br-1',
            stats: {
              audienceSize: 30,
              sent: 30,
              delivered: 29,
              opened: 20,
              clicked: 6,
              bounced: 1,
              unsubscribed: 0,
              failed: 0,
            },
            rates: {
              deliveryRate: 0.9667,
              openRate: 0.6897,
              clickRate: 0.2069,
              bounceRate: 0.0333,
              unsubRate: 0,
            },
            timeline: [{ date: '2026-06-01', sent: 30, opened: 20, clicked: 6 }],
            topClicks: [{ url: 'https://lumen.example/book', clicks: 6 }],
            topDomains: [{ domain: 'lumen.example', sent: 30, openRate: 0.6897 }],
          },
        }),
    })
  })
})

describe('PortalBroadcastAnalyticsPage', () => {
  it('keeps broadcast detail back links scoped to the CRM company workspace', async () => {
    render(
      <PortalBroadcastAnalyticsPage
        params={Promise.resolve({ id: 'br-1' })}
        searchParams={Promise.resolve({
          orgId: 'lumen-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen',
        })}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Broadcast detail' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to email analytics/i })).toHaveAttribute(
      'href',
      '/portal/email-analytics?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/email-analytics/broadcasts/br-1?orgId=lumen-org')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/email-analytics/broadcasts/br-1/heatmap?orgId=lumen-org')
  })
})
