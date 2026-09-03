import React from 'react'
import { render, screen } from '@testing-library/react'
import ReportView from '@/components/reports/ReportView'
import type { Report } from '@/lib/reports/types'

const report = {
  id: 'r1',
  type: 'monthly',
  brand: { orgName: 'Course Digs', text: '#fff', bg: '#000', accent: '#e4572e' },
  period: { start: '2026-08-01', end: '2026-08-31', tz: 'Africa/Johannesburg' },
  highlights: ['Bookings held steady.'],
  exec_summary: 'A quiet month with solid retention.',
  kpis: {
    total_revenue: 10000,
    mrr: 8000,
    active_subs: 12,
    sessions: 400,
    ad_revenue: 500,
    iap_revenue: 200,
    installs: 40,
    outstanding: 1500,
    deltas: {
      total_revenue: 2.5,
      mrr: 1.1,
      active_subs: 0,
      sessions: -3,
      ad_revenue: null,
      iap_revenue: null,
      installs: 5,
    },
  },
  series: [],
  properties: [],
} as unknown as Report

describe('ReportView studio chrome', () => {
  it('renders paper headings without banned display classes', () => {
    const { container } = render(<ReportView report={report} />)
    expect(screen.getByRole('heading', { name: 'Course Digs' })).toBeInTheDocument()
    expect(screen.getByText('Headline metrics')).toBeInTheDocument()
    expect(container.querySelector('.font-display')).toBeNull()
    expect(container.querySelector('.rounded-2xl')).toBeNull()
  })
})
