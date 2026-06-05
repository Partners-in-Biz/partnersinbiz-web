import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import EmailAnalyticsDashboard from '@/components/email-analytics/EmailAnalyticsDashboard'

jest.mock('@/components/email-analytics/charts', () => ({
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
                broadcast: { sent: 12, opened: 8, clicked: 3 },
                campaign: { sent: 0, opened: 0, clicked: 0 },
                sequence: { sent: 20, opened: 10, clicked: 4 },
                oneOff: { sent: 0, opened: 0, clicked: 0 },
              },
              topBroadcasts: [
                {
                  id: 'br-1',
                  name: 'June broadcast',
                  sent: 12,
                  opened: 8,
                  clicked: 3,
                  openRate: 0.67,
                  clickRate: 0.25,
                },
              ],
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

function renderPortalDashboard() {
  const Dashboard = EmailAnalyticsDashboard as React.ComponentType<{
    orgId: string
    isAdmin: boolean
    surface: 'portal'
    orgScope: { orgId: string; orgSlug: string }
  }>

  return render(
    <Dashboard
      orgId="lumen-org"
      isAdmin={false}
      surface="portal"
      orgScope={{ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }}
    />,
  )
}

describe('portal email analytics shared dashboard', () => {
  it('keeps broadcast analytics drilldowns scoped when opened from a CRM company workspace', async () => {
    renderPortalDashboard()

    expect(screen.getByRole('tab', { name: 'Broadcasts' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Leaderboard' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Broadcasts' }))

    const link = await screen.findByRole('link', { name: 'Open analytics for June broadcast' })
    expect(link).toHaveAttribute(
      'href',
      '/portal/email-analytics/broadcasts/br-1?orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })

  it('links active sequences to scoped portal sequence analytics drilldowns', async () => {
    renderPortalDashboard()

    fireEvent.click(screen.getByRole('tab', { name: 'Sequences' }))

    expect(await screen.findByText('Sequence performance')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Website welcome sequence/i })
    expect(link).toHaveAttribute(
      'href',
      '/portal/email-analytics/sequences/seq-1?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(screen.queryByRole('link', { name: /Dormant draft sequence/i })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/sequences?orgId=lumen-org')
    })
  })
})
