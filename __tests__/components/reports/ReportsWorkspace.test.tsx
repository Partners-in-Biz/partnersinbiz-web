import React from 'react'
import { render, screen } from '@testing-library/react'

import { ReportsWorkspace, type ReportsWorkspaceReport } from '@/components/reports/ReportsWorkspace'

jest.mock('next/link', () => {
  return function MockLink({
    href,
    children,
    className,
    target,
  }: {
    href: string
    children: React.ReactNode
    className?: string
    target?: string
  }) {
    return <a href={href} className={className} target={target}>{children}</a>
  }
})

const report: ReportsWorkspaceReport = {
  id: 'report-1',
  type: 'monthly',
  period: { start: '2026-05-01', end: '2026-05-31' },
  status: 'sent',
  publicToken: 'token-1',
  brand: { orgName: 'Lumen' },
  kpis: { total_revenue: 12000, mrr: 3000 },
  createdAt: { _seconds: 1780185600 },
  sentAt: { _seconds: 1780272000 },
}

describe('ReportsWorkspace', () => {
  it('renders the shared report card for portal viewers without admin send controls', () => {
    render(
      <ReportsWorkspace
        reports={[report]}
        loading={false}
        defaultOrgName="Lumen"
        mode="portal"
        emptyMessage="No reports yet."
      />,
    )

    expect(screen.getByText('Lumen - 2026-05-01 -> 2026-05-31')).toBeInTheDocument()
    expect(screen.getByText('Total revenue R 12 000 · MRR R 3 000')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open report/i })).toHaveAttribute('href', '/reports/token-1')
    expect(screen.queryByRole('button', { name: /send report/i })).not.toBeInTheDocument()
  })

  it('adds admin send controls to the same report card when provided', () => {
    render(
      <ReportsWorkspace
        reports={[{ ...report, status: 'rendered' }]}
        loading={false}
        defaultOrgName="Lumen"
        mode="admin"
        busyReportId={null}
        onSendReport={jest.fn()}
        emptyMessage="No reports yet."
      />,
    )

    expect(screen.getByRole('link', { name: /preview/i })).toHaveAttribute('href', '/reports/token-1')
    expect(screen.getByRole('button', { name: /send report/i })).toBeInTheDocument()
  })
})
