import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import OrganizationSettingsPage from '@/app/(portal)/portal/settings/organization/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

describe('Portal organisation settings page', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/organization' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            organization: {
              id: 'org-1',
              name: 'Client Trading',
              website: 'https://client.example',
              industry: 'Services',
              billingEmail: 'accounts@client.example',
              billingDetails: {
                legalName: 'Client Legal Pty Ltd',
                tradingName: 'Client Trading',
                registrationNumber: '2020/000000/07',
                vatNumber: '4000000000',
                taxNumber: '9999999999',
                phone: '+27 21 000 0000',
                address: { line1: '1 Main Road', city: 'Cape Town', postalCode: '8001', country: 'South Africa' },
                authorizedSignatory: { name: 'Owner Person', title: 'Director', email: 'owner@client.example' },
                accountsContact: { name: 'Accounts Person', email: 'accounts@client.example' },
                purchaseOrderRequired: true,
                purchaseOrderNumber: 'PO-123',
                invoiceInstructions: 'Email invoices monthly.',
              },
            },
            permissions: { canEdit: true, role: 'owner' },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/organization' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ updated: true }),
        } as Response)
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unexpected fetch' }) } as Response)
    }) as jest.Mock
  })

  it('renders editable legal, billing, signatory, and invoice fields without banking fields', async () => {
    render(<OrganizationSettingsPage />)

    await waitFor(() => expect(screen.getByDisplayValue('Client Legal Pty Ltd')).toBeInTheDocument())
    expect(screen.getByDisplayValue('2020/000000/07')).toBeInTheDocument()
    expect(screen.getByDisplayValue('4000000000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Owner Person')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Accounts Person')).toBeInTheDocument()
    expect(screen.getByLabelText(/Purchase order required/i)).toBeChecked()
    expect(screen.queryByLabelText(/Bank name/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Account number/i)).not.toBeInTheDocument()
  })

  it('summarizes organisation readiness before the long CRM settings form', async () => {
    render(<OrganizationSettingsPage />)

    const commandCenter = await screen.findByRole('region', { name: 'Organisation command center' })

    expect(commandCenter).toBeInTheDocument()
    expect(within(commandCenter).getByRole('heading', { name: 'Organisation command center' })).toBeInTheDocument()
    expect(within(commandCenter).getByText('4 ready areas')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Owner access')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Purchase order required')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Client Legal Pty Ltd')).toBeInTheDocument()
    expect(within(commandCenter).getByText('accounts@client.example')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Owner Person')).toBeInTheDocument()
  })

  it('saves organisation detail changes back to the portal route', async () => {
    render(<OrganizationSettingsPage />)

    const legalName = await screen.findByLabelText(/Legal company name/i)
    fireEvent.change(legalName, { target: { value: 'Updated Legal Pty Ltd' } })
    fireEvent.click(screen.getByRole('button', { name: /Save organisation details/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/settings/organization',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Updated Legal Pty Ltd'),
        }),
      )
    })
  })

  it('loads and saves organisation details through the active company workspace scope', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/organization?orgId=lumen-org' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            organization: {
              id: 'lumen-org',
              name: 'Lumen',
              billingEmail: 'accounts@lumenspeeds.com',
              billingDetails: {
                legalName: 'Lumen Speeds Pty Ltd',
                registrationNumber: '2024/123456/07',
                accountsContact: { name: 'Lumen Accounts', email: 'accounts@lumenspeeds.com' },
                authorizedSignatory: { name: 'Lumen Owner', email: 'owner@lumenspeeds.com' },
              },
            },
            permissions: { canEdit: true, role: 'admin' },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/organization?orgId=lumen-org' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ updated: true }),
        } as Response)
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: `unexpected fetch: ${url}` }) } as Response)
    }) as jest.Mock

    render(<OrganizationSettingsPage />)

    const legalName = await screen.findByLabelText(/Legal company name/i)
    expect(legalName).toHaveValue('Lumen Speeds Pty Ltd')
    fireEvent.change(legalName, { target: { value: 'Lumen Speeds Holdings' } })
    fireEvent.click(screen.getByRole('button', { name: /Save organisation details/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/settings/organization?orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/settings/organization?orgId=lumen-org',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Lumen Speeds Holdings'),
        }),
      )
      expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/portal/settings/organization')
    })
  })
})
