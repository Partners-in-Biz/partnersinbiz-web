import React from 'react'
import { render, screen } from '@testing-library/react'
import PortalSequenceAnalyticsPage from '@/app/(portal)/portal/email-analytics/sequences/[id]/page'

jest.mock('@/components/admin/email-analytics/charts', () => ({
  BarChart: () => <div data-testid="bar-chart" />,
  Donut: () => <div data-testid="donut-chart" />,
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
  fetchMock.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        data: {
          sequenceId: 'seq-1',
          sequence: {
            id: 'seq-1',
            name: 'Website welcome sequence',
            description: 'Turns new website leads into booked calls.',
            status: 'active',
            stepsCount: 1,
          },
          totalEnrollments: 42,
          byStatus: { active: 30, paused: 2, completed: 10, exited: 0 },
          averageCompletionDays: 6.5,
          insights: {
            completionRate: 0.2381,
            openRate: 0.7381,
            clickRate: 0.2857,
            weakestStepNumber: 1,
            nextActions: [
              'Review Step 1 subject, offer, and call to action because it has the largest drop-off.',
              'Connect this sequence to capture sources or automations that qualify website leads.',
            ],
          },
          stepFunnel: [
            {
              stepNumber: 1,
              subject: 'Welcome to the growth engine',
              sent: 42,
              opened: 31,
              clicked: 12,
              dropOffPercent: 0,
            },
          ],
        },
      }),
  })
})

describe('PortalSequenceAnalyticsPage', () => {
  it('renders sequence analytics for portal users', async () => {
    render(
      <PortalSequenceAnalyticsPage
        params={Promise.resolve({ id: 'seq-1' })}
        searchParams={Promise.resolve({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Website welcome sequence performance' })).toBeInTheDocument()
    expect(screen.getByText('Turns new website leads into booked calls.')).toBeInTheDocument()
    expect(screen.getByText('Active sequence · 1 step')).toBeInTheDocument()
    expect(screen.getByText('Agent next moves')).toBeInTheDocument()
    expect(screen.getByText(/Review Step 1 subject/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to email analytics/i })).toHaveAttribute(
      'href',
      '/portal/email-analytics?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(screen.getAllByText('42').length).toBeGreaterThan(0)
    expect(screen.getByText('Welcome to the growth engine')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/email-analytics/sequences/seq-1?orgId=lumen-org')
  })
})
