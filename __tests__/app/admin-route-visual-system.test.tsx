import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import OrgDocumentsPage from '@/app/(admin)/admin/org/[slug]/documents/page'
import BillingPage from '@/app/(admin)/admin/org/[slug]/billing/page'

let mockRouteParams = { slug: 'acme-co' }

jest.mock('next/navigation', () => ({
  useParams: () => mockRouteParams,
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('next/link', () => {
  return function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>
  }
})

jest.mock('@/components/admin/OrgThemedFrame', () => ({
  OrgThemedFrame: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  useOrgBrand: () => ({ brand: null }),
}))

jest.mock('@/components/client-documents/DocumentIndex', () => ({
  DocumentIndex: ({ documents }: { documents: Array<{ title?: string }> }) => (
    <div data-testid="document-index">{documents.map((doc, index) => <span key={index}>{doc.title}</span>)}</div>
  ),
}))

function mockFetchForVisualRoutes() {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/v1/organizations') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [{ id: 'org-1', slug: 'acme-co', name: 'Acme Co' }] }),
      } as Response)
    }
    if (url === '/api/v1/client-documents?orgId=org-1') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [{ id: 'doc-1', title: 'Launch spec', status: 'approved' }] }),
      } as Response)
    }
    if (url === '/api/v1/invoices?view=received&orgId=org-1') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [{ id: 'inv-1', invoiceNumber: 'INV-001', status: 'paid', total: 1200, currency: 'ZAR' }] }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
  }) as jest.Mock
}

describe('admin route visual system adoption', () => {
  beforeEach(() => {
    mockRouteParams = { slug: 'acme-co' }
    mockFetchForVisualRoutes()
  })

  it('renders client documents with shared PageHeader and tab primitives', async () => {
    const { container } = render(<OrgDocumentsPage />)

    await waitFor(() => expect(screen.getByText('Launch spec')).toBeInTheDocument())

    expect(container.querySelector('.pib-page-header')).toBeInTheDocument()
    expect(container.querySelector('.pib-tabs')).toBeInTheDocument()
    expect(container.querySelector('.pib-tab-active')).toHaveTextContent(/All/i)
  })

  it('renders billing with shared PageHeader, Surface table, StatusPill, and empty-state-compatible primitives', async () => {
    const { container } = render(<BillingPage />)

    await waitFor(() => expect(screen.getByText('INV-001')).toBeInTheDocument())

    expect(container.querySelector('.pib-page-header')).toBeInTheDocument()
    expect(container.querySelector('.pib-surface-table')).toBeInTheDocument()
    expect(container.querySelector('.pib-pill-success')).toHaveTextContent('Paid')
  })

  it('uses PiB-issued received invoices for the platform owner billing route', async () => {
    mockRouteParams = { slug: 'partners-in-biz' }
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'org-1', slug: 'acme-co', name: 'Acme Co' }] }),
        } as Response)
      }
      if (url === '/api/v1/invoices?view=received&billingOrgId=pib-platform-owner') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'inv-pib', invoiceNumber: 'INV-PIB', status: 'sent', total: 900, currency: 'ZAR' }] }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<BillingPage />)

    await waitFor(() => expect(screen.getByText('INV-PIB')).toBeInTheDocument())

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/invoices?view=received&billingOrgId=pib-platform-owner')
    expect(screen.getByRole('link', { name: '+ New Invoice' })).toHaveAttribute('href', '/admin/invoicing/new')
  })
})
