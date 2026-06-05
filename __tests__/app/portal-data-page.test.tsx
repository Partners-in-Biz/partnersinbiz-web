import React from 'react'
import { render, screen } from '@testing-library/react'
import PortalData from '@/app/(portal)/portal/data/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

describe('PortalData', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
  })

  it('names data export commands without decorative icon text', () => {
    render(<PortalData />)

    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'download Download CSV' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code Download JSON' })).not.toBeInTheDocument()
  })

  it('preserves the active company workspace when starting an export', () => {
    mockSearchParams = new URLSearchParams(
      'orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )

    render(<PortalData />)

    expect(screen.getByText('Lumen workspace')).toBeInTheDocument()
    const csvExport = screen.getByRole('button', { name: 'Download CSV' })

    expect(csvExport).toHaveAttribute(
      'href',
      expect.stringMatching(
        /^\/api\/v1\/portal\/data-export\?format=csv&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&orgId=lumen-org$/,
      ),
    )
  })

  it('frames exports as a CRM data command center', () => {
    render(<PortalData />)

    expect(screen.getByRole('heading', { name: 'Data export command center' })).toBeInTheDocument()
    expect(screen.getByText('CRM-ready backup')).toBeInTheDocument()
    expect(screen.getByText('CSV + JSON')).toBeInTheDocument()
  })
})
