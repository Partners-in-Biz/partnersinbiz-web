import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ProjectPortfolioReportPanel } from '@/components/projects/ProjectPortfolioReportPanel'

describe('ProjectPortfolioReportPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          summary: {
            totalProjects: 2,
            openTasks: 7,
            blockedTasks: 1,
            overdueTasks: 2,
            waitingApprovals: 3,
            highRisks: 1,
            overCapacityPeople: 1,
            trackedRevenue: 35000,
            currency: 'ZAR',
            mixedCurrency: false,
          },
          clients: [
            { clientOrgId: 'client-1', clientName: 'Client One', projectCount: 1, trackedRevenue: 25000, openTasks: 4, blockedTasks: 1, highRisks: 1 },
          ],
          people: [
            { uid: 'user-1', name: 'Peet Stander', assignedTasks: 5, estimateMinutes: 1200, capacityMinutes: 1000, utilizationPercent: 120, overCapacity: true },
          ],
          projects: [
            {
              id: 'project-1',
              name: 'Website launch',
              status: 'development',
              health: { status: 'at_risk', score: 62 },
              reports: {
                tasks: { open: 4, blocked: 1 },
                risks: { high: 1 },
                revenue: { trackedAmount: 25000, currency: 'ZAR' },
              },
              timeline: { driftCount: 1, dependencyCount: 2 },
            },
          ],
        },
      }),
    })) as jest.Mock
  })

  it('renders portfolio, client, workload, and project health from the reporting API', async () => {
    render(<ProjectPortfolioReportPanel reportUrl="/api/v1/projects/reporting?orgId=owner-org" />)

    expect(screen.getByText('Loading portfolio report')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('Portfolio report')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/reporting?orgId=owner-org', expect.any(Object))
    expect(screen.getByText('2 projects')).toBeInTheDocument()
    expect(screen.getAllByText('1 blocked').length).toBeGreaterThan(0)
    expect(screen.getByText('3 approvals')).toBeInTheDocument()
    expect(screen.getByText('Client One')).toBeInTheDocument()
    expect(screen.getByText('Peet Stander')).toBeInTheDocument()
    expect(screen.getByText('120%')).toBeInTheDocument()
    expect(screen.getByText('Website launch')).toBeInTheDocument()
    expect(screen.getByText(/at risk/i)).toBeInTheDocument()
  })

  it('shows a quiet empty state when reporting data is unavailable', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Forbidden' }),
    })

    render(<ProjectPortfolioReportPanel reportUrl="/api/v1/projects/reporting?orgId=blocked" />)

    await waitFor(() => expect(screen.getByText('Portfolio report unavailable')).toBeInTheDocument())
    expect(screen.getByText('Forbidden')).toBeInTheDocument()
  })
})
