import React from 'react'
import { fireEvent } from '@testing-library/react'
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
  async function renderPortalIntegrationsPage() {
    render(await PortalIntegrationsPage({ searchParams: Promise.resolve({}) }))
  }

  it('renders CRM integrations as an import operations command center', async () => {
    await renderPortalIntegrationsPage()

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

  it('turns an empty integrations list into a direct source connection action', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/integrations')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
      }
      if (url.startsWith('/api/v1/campaigns')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    })

    await renderPortalIntegrationsPage()

    expect(await screen.findByRole('heading', { name: 'No connected CRM sources yet.' })).toBeInTheDocument()
    expect(screen.getByText('Connect the first source so a CEO can see where contacts come from, whether imports are healthy, and which employees own the next follow-up.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Mailchimp' }))

    expect(screen.getByRole('heading', { name: 'Connect Mailchimp' })).toBeInTheDocument()
  })

  it('names provider setup choices by action and current selection state', async () => {
    await renderPortalIntegrationsPage()

    const mailchimp = await screen.findByRole('button', { name: 'Choose Mailchimp CRM source setup' })
    expect(mailchimp).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Choose HubSpot CRM source setup' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Choose Google Contacts CRM source setup' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Zapier / n8n / Make API capture source setup unavailable' })).toBeDisabled()

    fireEvent.click(mailchimp)

    expect(screen.getByRole('button', { name: 'Selected Mailchimp CRM source setup' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('confirms sparse integration deletes in the CRM page instead of a browser prompt', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/integrations/integration-sparse' && init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: null }) })
      }
      if (url.startsWith('/api/v1/crm/integrations')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: 'integration-sparse',
                  provider: 'mailchimp',
                  name: '   ',
                  status: 'active',
                  cadenceMinutes: 60,
                  autoTags: [],
                  autoCampaignIds: [],
                  lastSyncedAt: null,
                  lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
                  lastError: '',
                  configPreview: { listId: 'list-001' },
                },
              ],
            }),
        })
      }
      if (url.startsWith('/api/v1/campaigns')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    })

    await renderPortalIntegrationsPage()

    expect(await screen.findByText('Integration name missing')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete integration Integration name missing' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Delete integration "Integration name missing"?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This disconnects the CRM source, stops future syncs, and keeps imported contact history available for audit.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete integration Integration name missing' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/integrations/integration-sparse', { method: 'DELETE' })
      expect(screen.queryByText('Integration name missing')).not.toBeInTheDocument()
    })

    confirmSpy.mockRestore()
  })
})
