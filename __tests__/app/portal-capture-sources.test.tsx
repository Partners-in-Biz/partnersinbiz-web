import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalCaptureSourcesPage from '@/app/(portal)/portal/capture-sources/page'
import PortalCaptureSourceImportPage from '@/app/(portal)/portal/capture-sources/import/page'

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
    if (url.startsWith('/api/v1/crm/capture-sources')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: 'src-form',
                orgId: 'org-1',
                name: 'Homepage enquiry form',
                type: 'form',
                publicKey: 'pub-form',
                enabled: true,
                autoTags: ['website', 'priority'],
                autoCampaignIds: ['campaign-1'],
                autoSequenceIds: ['seq-1'],
                redirectUrl: 'https://example.com/thanks',
                consentRequired: true,
                capturedCount: 32,
                lastCapturedAt: { seconds: 1779915600 },
                createdAt: null,
                updatedAt: null,
              },
              {
                id: 'src-api',
                orgId: 'org-1',
                name: 'Partner API intake',
                type: 'api',
                publicKey: 'pub-api',
                enabled: false,
                autoTags: [],
                autoCampaignIds: [],
                autoSequenceIds: [],
                redirectUrl: '',
                consentRequired: false,
                capturedCount: 0,
                lastCapturedAt: null,
                createdAt: null,
                updatedAt: null,
              },
            ],
          }),
      })
    }
    if (url.startsWith('/api/v1/campaigns')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: 'campaign-1', name: 'Lead nurture', status: 'active' }],
          }),
      })
    }
    if (url.startsWith('/api/v1/crm/sequences')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              sequences: [{ id: 'seq-1', name: 'Website welcome sequence', status: 'active' }],
            },
          }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
  })
})

describe('PortalCaptureSourcesPage', () => {
  it('names intake setup commands without decorative icon text', async () => {
    render(<PortalCaptureSourcesPage />)

    expect(await screen.findByRole('link', { name: 'Import CSV' })).toHaveAttribute(
      'href',
      '/portal/capture-sources/import',
    )
    expect(screen.queryByRole('link', { name: 'upload_file Import CSV' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Capture source type' })).toBeInTheDocument()
  })

  it('renders capture sources as a lead intake command center', async () => {
    render(<PortalCaptureSourcesPage />)

    expect(await screen.findByText('Capture command center')).toBeInTheDocument()
    expect(screen.getByText('Total captures')).toBeInTheDocument()
    expect(screen.getByText('Active channels')).toBeInTheDocument()
    expect(screen.getByText('Conversion focus')).toBeInTheDocument()
    expect(screen.getByText('Needs attention')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Homepage enquiry form')).toBeInTheDocument()
      expect(screen.getByText('Partner API intake')).toBeInTheDocument()
    })

    expect(screen.getByText('Ready for traffic')).toBeInTheDocument()
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0)
    expect(screen.getByText('Auto-enrolls')).toBeInTheDocument()
    expect(screen.getByText('No captures yet')).toBeInTheDocument()
  })

  it('shows sequence enrollment controls for capture sources', async () => {
    render(<PortalCaptureSourcesPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Details for Homepage enquiry form' }))

    expect(await screen.findByText('Auto-enroll sequences')).toBeInTheDocument()
    expect(screen.getByLabelText('Website welcome sequence')).toBeChecked()
  })

  it('uses an in-page confirmation before deleting a capture source', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<PortalCaptureSourcesPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Details for Homepage enquiry form' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete capture source Homepage enquiry form' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete capture source "Homepage enquiry form"?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the tracked intake channel, embed/API key, and future attribution path. Existing captured contacts and CRM history stay available for audit.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/capture-sources/src-form', expect.objectContaining({ method: 'DELETE' }))
    expect(screen.getByRole('button', { name: 'Cancel delete for capture source Homepage enquiry form' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete capture source Homepage enquiry form' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/capture-sources/src-form', { method: 'DELETE' })
    })
    expect(screen.queryByText('Homepage enquiry form')).not.toBeInTheDocument()

    confirmSpy.mockRestore()
  })

  it('uses an in-page confirmation before rotating a capture source key', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<PortalCaptureSourcesPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Details for Homepage enquiry form' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate public key for Homepage enquiry form' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Rotate public key for "Homepage enquiry form"?' })).toBeInTheDocument()
    expect(screen.getByText('This immediately invalidates the current embed/API key. Update every form, API client, and integration using this capture source before sending more traffic.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/capture-sources/src-form', expect.objectContaining({ method: 'PUT' }))
    expect(screen.getByRole('button', { name: 'Cancel key rotation for capture source Homepage enquiry form' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm rotate public key for capture source Homepage enquiry form' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/capture-sources/src-form', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ rotateKey: true }),
      }))
    })

    confirmSpy.mockRestore()
  })

  it('names sparse capture source rows and confirmations instead of exposing blank controls', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/capture-sources') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: 'src-sparse',
                  orgId: 'org-1',
                  name: '',
                  type: 'form',
                  publicKey: 'pub-sparse',
                  enabled: true,
                  autoTags: [],
                  autoCampaignIds: [],
                  autoSequenceIds: [],
                  redirectUrl: '',
                  consentRequired: false,
                  capturedCount: 0,
                  lastCapturedAt: null,
                  createdAt: null,
                  updatedAt: null,
                },
              ],
            }),
        })
      }
      if (url === '/api/v1/crm/capture-sources/src-sparse' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                id: 'src-sparse',
                orgId: 'org-1',
                name: '',
                type: 'form',
                publicKey: 'pub-sparse-rotated',
                enabled: true,
                autoTags: [],
                autoCampaignIds: [],
                autoSequenceIds: [],
                redirectUrl: '',
                consentRequired: false,
                capturedCount: 0,
                lastCapturedAt: null,
                createdAt: null,
                updatedAt: null,
              },
            }),
        })
      }
      if (url === '/api/v1/crm/capture-sources/src-sparse' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { ok: true } }),
        })
      }
      if (url.startsWith('/api/v1/campaigns')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
      }
      if (url.startsWith('/api/v1/crm/sequences')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { sequences: [] } }) })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalCaptureSourcesPage />)

    expect(await screen.findByText('Capture source name missing')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Details for Capture source name missing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rotate public key for Capture source name missing' }))

    expect(screen.getByRole('alertdialog', { name: 'Rotate public key for "Capture source name missing"?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel key rotation for capture source Capture source name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm rotate public key for capture source Capture source name missing' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel key rotation for capture source Capture source name missing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete capture source Capture source name missing' }))

    expect(screen.getByRole('alertdialog', { name: 'Delete capture source "Capture source name missing"?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel delete for capture source Capture source name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm delete capture source Capture source name missing' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete capture source Capture source name missing' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/capture-sources/src-sparse', { method: 'DELETE' })
    })
    expect(screen.queryByText('Capture source name missing')).not.toBeInTheDocument()
  })

  it('turns an empty capture-source list into a first-channel setup action', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/capture-sources')) {
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

    render(<PortalCaptureSourcesPage />)

    expect(await screen.findByRole('heading', { name: 'No tracked intake channels yet.' })).toBeInTheDocument()
    expect(screen.getByText('Create the first capture source so contacts arrive with source attribution, consent context, tags, and a visible follow-up path for the team.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set up first form source' }))

    expect(screen.getByPlaceholderText('Source name (e.g. Homepage form)')).toHaveFocus()
  })

  it('warns when capture sources fail to load and gives leaders a retry path', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/capture-sources') {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Capture source index unavailable' }),
        })
      }
      if (url.startsWith('/api/v1/campaigns')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
      }
      if (url.startsWith('/api/v1/crm/sequences')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { sequences: [] } }) })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalCaptureSourcesPage />)

    expect(await screen.findByRole('heading', { name: 'Capture sources could not load' })).toBeInTheDocument()
    expect(screen.getByText('Capture source index unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No tracked intake channels yet.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading capture sources' }))

    await waitFor(() => {
      const sourceRequests = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/crm/capture-sources')
      expect(sourceRequests).toHaveLength(2)
    })
  })
})

describe('PortalCaptureSourceImportPage', () => {
  it('renders CSV imports as a governed intake command center', async () => {
    render(<PortalCaptureSourceImportPage />)

    expect(await screen.findByText('CSV intake command center')).toBeInTheDocument()
    expect(screen.getByText('Import readiness')).toBeInTheDocument()
    expect(screen.getByText('Rows parsed')).toBeInTheDocument()
    expect(screen.getByText('Attribution source')).toBeInTheDocument()
    expect(screen.getByText('Validation gate')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Homepage enquiry form - form')).toBeInTheDocument()
      expect(screen.getByText('Partner API intake - api')).toBeInTheDocument()
    })
  })
})
