import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WebhookSettingsClient } from '@/components/crm/webhooks/WebhookSettingsClient'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

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
    mockSearchParams = new URLSearchParams()
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

  it('preserves explicit company workspace scope across webhook CRUD and delivery actions', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
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
          json: async () => ({ orgId: 'wrong-active-org' }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks?limit=100&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { items: [webhook] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks?orgId=lumen-org' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { secretOnce: 'whsec_created_secret' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks/webhook-1?orgId=lumen-org' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { webhook: { ...webhook, name: 'Warehouse sync updated' } } }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks/webhook-1/test?orgId=lumen-org' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { queued: true } }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks/webhook-1/rotate-secret?orgId=lumen-org' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { secretOnce: 'whsec_rotated_secret' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks/webhook-1?orgId=lumen-org' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { ok: true } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<WebhookSettingsClient />)

    expect(await screen.findByText('Warehouse sync')).toBeInTheDocument()
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks?limit=100&orgId=lumen-org')
    })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fulfilment feed' } })
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'https://ops.example.com/hooks/pib' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks?orgId=lumen-org', expect.objectContaining({ method: 'POST' }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit webhook subscription Warehouse sync' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Warehouse sync updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save webhook' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1?orgId=lumen-org', expect.objectContaining({ method: 'PUT' }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test webhook subscription Warehouse sync' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1/test?orgId=lumen-org', { method: 'POST' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rotate webhook signing secret Warehouse sync' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rotate webhook signing secret Warehouse sync' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1/rotate-secret?orgId=lumen-org', { method: 'POST' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete webhook subscription Warehouse sync' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete webhook subscription Warehouse sync' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1?orgId=lumen-org', { method: 'DELETE' })
    })
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/webhooks?limit=100&orgId=wrong-active-org')
  })

  it('warns when webhook subscriptions fail to load and gives leaders a retry path', async () => {
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
          ok: false,
          json: async () => ({ error: 'Webhook delivery source unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<WebhookSettingsClient />)

    expect(await screen.findByRole('heading', { name: 'Webhook subscriptions could not load' })).toBeInTheDocument()
    expect(screen.getByText('Webhook delivery source unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Launch your first outbound CRM bridge')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading webhook subscriptions' }))

    await waitFor(() => {
      const webhookRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/webhooks?limit=100&orgId=org-webhooks'
      ))
      expect(webhookRequests).toHaveLength(2)
    })
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
      if (url === '/api/v1/crm/webhooks/webhook-1?orgId=org-webhooks' && init?.method === 'DELETE') {
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
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1?orgId=org-webhooks', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel delete webhook subscription Warehouse sync' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete webhook subscription Warehouse sync' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1?orgId=org-webhooks', { method: 'DELETE' })
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
      if (url === '/api/v1/crm/webhooks/webhook-1/rotate-secret?orgId=org-webhooks' && init?.method === 'POST') {
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
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1/rotate-secret?orgId=org-webhooks', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel rotate webhook signing secret Warehouse sync' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm rotate webhook signing secret Warehouse sync' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-1/rotate-secret?orgId=org-webhooks', { method: 'POST' })
    })
    expect(await screen.findByText('whsec_rotated_secret')).toBeInTheDocument()

    confirmSpy.mockRestore()
  })

  it('names sparse webhook subscriptions across row actions and confirmations', async () => {
    const webhook = {
      id: 'webhook-sparse',
      name: '',
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
      if (url === '/api/v1/crm/webhooks/webhook-sparse/rotate-secret?orgId=org-webhooks' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { secretOnce: 'whsec_rotated_secret' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/webhooks/webhook-sparse?orgId=org-webhooks' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { ok: true } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<WebhookSettingsClient />)

    expect(await screen.findByText('Webhook subscription name missing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test webhook subscription Webhook subscription name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disable webhook subscription Webhook subscription name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit webhook subscription Webhook subscription name missing' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate webhook signing secret Webhook subscription name missing' }))

    expect(screen.getByRole('alertdialog', { name: 'Rotate signing secret for "Webhook subscription name missing"?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel rotate webhook signing secret Webhook subscription name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm rotate webhook signing secret Webhook subscription name missing' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel rotate webhook signing secret Webhook subscription name missing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete webhook subscription Webhook subscription name missing' }))

    expect(screen.getByRole('alertdialog', { name: 'Delete webhook subscription "Webhook subscription name missing"?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel delete webhook subscription Webhook subscription name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm delete webhook subscription Webhook subscription name missing' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete webhook subscription Webhook subscription name missing' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/webhooks/webhook-sparse?orgId=org-webhooks', { method: 'DELETE' })
    })
  })
})
