import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

import PortalDocumentsPage from '@/app/(portal)/portal/documents/page'

jest.mock('next/link', () => {
  return function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>
  }
})

describe('portal documents page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads documents for the active portal org when the viewer is an admin', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'org-1', name: 'Client One' },
            user: { role: 'admin' },
          }),
        } as Response)
      }
      if (url === '/api/v1/client-documents?orgId=org-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'doc-1',
                orgId: 'pib-platform-owner',
                title: 'Foce Property Investments Proposal',
                type: 'sales_proposal',
                status: 'client_review',
                linked: { clientOrgId: 'org-1' },
              },
            ],
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ success: false, error: 'orgId is required' }),
      } as Response)
    }) as jest.Mock

    render(<PortalDocumentsPage />)

    await waitFor(() => {
      expect(screen.getByText('Foce Property Investments Proposal')).toBeInTheDocument()
    })
    expect(screen.getByText('Prepared by')).toBeInTheDocument()
    expect(screen.getByText('Partners in Biz')).toBeInTheDocument()
    expect(screen.getByText('Recipient')).toBeInTheDocument()
    expect(screen.getByText('Client One')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/org', { cache: 'no-store' })
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/client-documents?orgId=org-1')
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/client-documents')
  })
})
