import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

import PortalReportsPage from '@/app/(portal)/portal/reports/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => {
  return function MockLink({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) {
    return <a href={href} className={className}>{children}</a>
  }
})

describe('portal reports page', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    jest.clearAllMocks()
  })

  it('loads reports for the active portal organisation by default', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/reports') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            reports: [
              {
                id: 'report-1',
                type: 'monthly',
                period: { start: '2026-05-01', end: '2026-05-31' },
                status: 'sent',
                publicToken: 'token-1',
                kpis: { total_revenue: 12000, mrr: 3000 },
                sentAt: { _seconds: 1780272000 },
                createdAt: { _seconds: 1780185600 },
              },
            ],
          }),
        } as Response)
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unexpected fetch' }) } as Response)
    }) as jest.Mock

    render(<PortalReportsPage />)

    await waitFor(() => expect(screen.getByText('2026-05-01 -> 2026-05-31')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/reports')
    expect(screen.getByRole('link', { name: /crm reports/i })).toHaveAttribute('href', '/portal/reports/crm')
  })

  it('loads reports for the company-scoped portal org when opened from CRM workspace', async () => {
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/reports?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            reports: [
              {
                id: 'lumen-report',
                type: 'monthly',
                period: { start: '2026-06-01', end: '2026-06-30' },
                status: 'sent',
                publicToken: 'lumen-token',
                kpis: { total_revenue: 25000, mrr: 5000 },
                sentAt: { _seconds: 1782864000 },
                createdAt: { _seconds: 1782777600 },
              },
            ],
          }),
        } as Response)
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unexpected fetch' }) } as Response)
    }) as jest.Mock

    render(<PortalReportsPage />)

    await waitFor(() => expect(screen.getByText('2026-06-01 -> 2026-06-30')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/reports?orgId=lumen-org')
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/portal/reports')
    expect(screen.getByRole('link', { name: /crm reports/i })).toHaveAttribute(
      'href',
      '/portal/reports/crm?orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })
})
