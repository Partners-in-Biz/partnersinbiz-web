import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import PortalIntegrationsPage from '@/app/(portal)/portal/integrations/page'

const fetchMock = jest.fn()

beforeAll(() => {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    value: fetchMock,
  })
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/v1/crm/integrations')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: 'int-mailchimp',
                provider: 'mailchimp',
                name: 'Audience growth',
                status: 'active',
                cadenceMinutes: 60,
                autoTags: ['newsletter', 'warm'],
                autoCampaignIds: ['campaign-1'],
                lastSyncedAt: { seconds: 1779915600 },
                lastSyncStats: { imported: 42, created: 12, updated: 30, skipped: 1, errored: 0 },
                lastError: '',
                configPreview: { apiKey: '•••••us21', listId: 'abc123' },
              },
              {
                id: 'int-hubspot',
                provider: 'hubspot',
                name: 'HubSpot sales contacts',
                status: 'error',
                cadenceMinutes: 1440,
                autoTags: [],
                autoCampaignIds: [],
                lastSyncedAt: null,
                lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 3 },
                lastError: 'Token expired',
                configPreview: { accessToken: '•••••7890' },
              },
            ],
          }),
      })
    }
    if (url.startsWith('/api/v1/campaigns')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'campaign-1', name: 'Lead nurture', status: 'active' }] }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
  })
})

describe('PortalIntegrationsPage', () => {
  it('renders CRM integrations as an import operations command center', async () => {
    render(<PortalIntegrationsPage />)

    expect(await screen.findByText('Integration command center')).toBeInTheDocument()
    expect(screen.getByText('Connected sources')).toBeInTheDocument()
    expect(screen.getByText('Healthy syncs')).toBeInTheDocument()
    expect(screen.getByText('Imported contacts')).toBeInTheDocument()
    expect(screen.getByText('Needs attention')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Audience growth')).toBeInTheDocument()
      expect(screen.getByText('HubSpot sales contacts')).toBeInTheDocument()
    })

    expect(screen.getByText('Healthy sync')).toBeInTheDocument()
    expect(screen.getByText('Needs review')).toBeInTheDocument()
    expect(screen.getByText('Auto-enrolls')).toBeInTheDocument()
    expect(screen.getByText('No nurture routing')).toBeInTheDocument()
  })
})
