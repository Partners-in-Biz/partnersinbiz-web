import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WebhookSettingsClient } from '@/components/crm/webhooks/WebhookSettingsClient'

describe('WebhookSettingsClient', () => {
  const mockFetch = (items: unknown[] = []) => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/active-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ orgId: 'org-webhooks' }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks?limit=100&orgId=org-webhooks') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { items } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('turns empty webhook subscriptions into an integration launch checklist', async () => {
    render(<WebhookSettingsClient />)

    expect(await screen.findByText('Launch your first outbound CRM bridge')).toBeInTheDocument()
    expect(screen.getByText('Endpoint')).toBeInTheDocument()
    expect(screen.getAllByText('Event coverage').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Signing secret')).toBeInTheDocument()
    expect(screen.getByText('Delivery test')).toBeInTheDocument()
    expect(screen.getByText('Fill in the subscription form above to create the first signed delivery endpoint.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create webhook' })).toBeDisabled()
  })

  it('keeps webhook health timestamps executive-readable when API dates are malformed', async () => {
    mockFetch([
      {
        id: 'webhook-1',
        name: 'Warehouse sync',
        url: 'https://warehouse.example.com/pib',
        events: ['contact.created'],
        active: true,
        failureCount: 0,
        lastDeliveredAt: 'not-a-date',
        lastFailureAt: { seconds: 'bad' },
        secretRotatedAt: { _seconds: 1774003200 },
      },
    ])

    render(<WebhookSettingsClient />)

    expect(await screen.findByText('Warehouse sync')).toBeInTheDocument()
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument()
    expect(screen.getByText('Last delivery: Date unavailable')).toBeInTheDocument()
    expect(screen.getByText('Last failure: Date unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Secret: /)).toHaveTextContent('Secret: 20 Mar 2026')
  })

  it('uses an in-page confirmation before deleting a webhook subscription', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const webhook = {
      id: 'webhook-1',
      name: 'Warehouse sync',
      url: 'https://warehouse.example.com/pib',
      events: ['contact.created'],
      active: true,
      failureCount: 0,
    }

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/active-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ orgId: 'org-webhooks' }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks?limit=100&orgId=org-webhooks') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { items: [webhook] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks/webhook-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { ok: true } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<WebhookSettingsClient />)

    expect(await screen.findByText('Warehouse sync')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete webhook subscription Warehouse sync' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete webhook subscription "Warehouse sync"?' })).toBeInTheDocument()
    expect(screen.getByText('This stops outbound CRM deliveries to https://warehouse.example.com/pib. Delivery history stays available for audit.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel delete webhook subscription Warehouse sync' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete webhook subscription Warehouse sync' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1', { method: 'DELETE' })
    })

    confirmSpy.mockRestore()
  })

  it('uses an in-page confirmation before rotating a webhook signing secret', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const webhook = {
      id: 'webhook-1',
      name: 'Warehouse sync',
      url: 'https://warehouse.example.com/pib',
      events: ['contact.created'],
      active: true,
      failureCount: 0,
    }

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/active-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ orgId: 'org-webhooks' }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks?limit=100&orgId=org-webhooks') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { items: [webhook] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks/webhook-1/rotate-secret' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { secretOnce: 'whsec_rotated_secret' } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<WebhookSettingsClient />)

    expect(await screen.findByText('Warehouse sync')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate webhook signing secret Warehouse sync' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Rotate signing secret for "Warehouse sync"?' })).toBeInTheDocument()
    expect(screen.getByText('Existing consumers must be updated immediately after rotation. The new secret is shown once for the CEO or integration owner to store securely.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1/rotate-secret', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel rotate webhook signing secret Warehouse sync' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm rotate webhook signing secret Warehouse sync' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1/rotate-secret', { method: 'POST' })
    })
    expect(await screen.findByText('whsec_rotated_secret')).toBeInTheDocument()

    confirmSpy.mockRestore()
  })
})
