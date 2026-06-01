import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { EmailAnalyticsClient } from '@/app/(portal)/portal/email-analytics/EmailAnalyticsClient'

jest.mock('@/components/admin/email-analytics/charts', () => ({
  LineChart: () => <div data-testid="line-chart" />,
  Donut: () => <div data-testid="donut-chart" />,
  BarChart: () => <div data-testid="bar-chart" />,
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
    if (url.startsWith('/api/v1/email-analytics/overview')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              range: { from: '2026-05-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' },
              totals: {
                sent: 20,
                delivered: 20,
                opened: 10,
                clicked: 4,
                bounced: 0,
                unsubscribed: 0,
                failed: 0,
              },
              rates: {
                deliveryRate: 1,
                openRate: 0.5,
                clickRate: 0.2,
                ctrOnOpens: 0.4,
                bounceRate: 0,
                unsubRate: 0,
              },
              bySource: {
                broadcast: { sent: 0, opened: 0, clicked: 0 },
                campaign: { sent: 0, opened: 0, clicked: 0 },
                sequence: { sent: 20, opened: 10, clicked: 4 },
                oneOff: { sent: 0, opened: 0, clicked: 0 },
              },
              topBroadcasts: [],
              topCampaigns: [],
              worstBounces: [],
            },
          }),
      })
    }
    if (url.startsWith('/api/v1/email-analytics/timeseries')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              range: { from: '2026-05-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' },
              bucket: 'day',
              series: [{ date: '2026-05-31', sent: 20, delivered: 20, opened: 10, clicked: 4, bounced: 0 }],
            },
          }),
      })
    }
    if (url.startsWith('/api/v1/crm/sequences')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              sequences: [
                { id: 'seq-1', name: 'Website welcome sequence', status: 'active' },
                { id: 'seq-2', name: 'Dormant draft sequence', status: 'draft' },
              ],
            },
          }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
  })
})

describe('EmailAnalyticsClient', () => {
  it('links active sequences to portal sequence analytics drilldowns', async () => {
    render(<EmailAnalyticsClient orgId="org-1" />)

    expect(await screen.findByText('Sequence performance')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Website welcome sequence/i })
    expect(link).toHaveAttribute('href', '/portal/email-analytics/sequences/seq-1')
    expect(screen.queryByRole('link', { name: /Dormant draft sequence/i })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/crm/sequences'))
    })
  })
})
