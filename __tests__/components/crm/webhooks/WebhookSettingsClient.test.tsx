import { render, screen } from '@testing-library/react'
import { WebhookSettingsClient } from '@/components/crm/webhooks/WebhookSettingsClient'

describe('WebhookSettingsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
          json: async () => ({ data: { items: [] } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns empty webhook subscriptions into an integration launch checklist', async () => {
    render(<WebhookSettingsClient />)

    expect(await screen.findByText('Launch your first outbound CRM bridge')).toBeInTheDocument()
    expect(screen.getByText('Endpoint')).toBeInTheDocument()
    expect(screen.getAllByText('Event coverage').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Signing secret')).toBeInTheDocument()
    expect(screen.getByText('Delivery test')).toBeInTheDocument()
    expect(screen.getByText('Fill in the subscription form above to create the first signed delivery endpoint.')).toBeInTheDocument()
  })
})
