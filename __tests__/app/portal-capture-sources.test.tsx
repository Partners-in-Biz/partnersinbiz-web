import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
  })
})

describe('PortalCaptureSourcesPage', () => {
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
