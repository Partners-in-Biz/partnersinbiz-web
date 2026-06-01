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
          totalEnrollments: 42,
          byStatus: { active: 30, paused: 2, completed: 10, exited: 0 },
          averageCompletionDays: 6.5,
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
    render(<PortalSequenceAnalyticsPage params={Promise.resolve({ id: 'seq-1' })} />)

    expect(await screen.findByRole('heading', { name: 'Sequence performance' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to email analytics/i })).toHaveAttribute(
      'href',
      '/portal/email-analytics',
    )
    expect(screen.getAllByText('42').length).toBeGreaterThan(0)
    expect(screen.getByText('Welcome to the growth engine')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/email-analytics/sequences/seq-1')
  })
})
