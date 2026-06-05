import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ScoringPage from '@/app/(portal)/portal/settings/scoring/page'

let mockSearchParams = new URLSearchParams()

jest.mock('@/components/crm/IcpProfileEditor', () => ({
  IcpProfileEditor: () => <div>ICP editor ready</div>,
}))

jest.mock('@/components/crm/LeadWeightsEditor', () => ({
  LeadWeightsEditor: () => <div>Lead weights editor ready</div>,
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

describe('Portal settings scoring page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/scoring/config') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              config: {
                orgId: 'org-scoring',
                icp: {},
                leadWeights: {},
                aiEnabled: false,
                aiCacheHours: 24,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/scoring/recompute-all' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { processed: 12, succeeded: 11, failed: 1 } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('preserves company workspace scope across scoring config load, save, and recompute', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'org-1',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/scoring/config?orgId=org-1' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              config: {
                orgId: 'org-1',
                icp: {},
                leadWeights: {},
                aiEnabled: false,
                aiCacheHours: 24,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/scoring/config?orgId=org-1' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              config: {
                orgId: 'org-1',
                icp: {},
                leadWeights: {},
                aiEnabled: false,
                aiCacheHours: 24,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/scoring/recompute-all?orgId=org-1' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { processed: 12, succeeded: 11, failed: 1 } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })
    global.fetch = fetchMock as jest.Mock

    render(<ScoringPage />)

    expect(await screen.findByText('Model setup priorities')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/scoring/config?orgId=org-1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save model' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/scoring/config?orgId=org-1', expect.objectContaining({ method: 'PUT' }))
    })

    fireEvent.click(screen.getByRole('button', { name: /Recompute all/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm recompute all contact scores' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/scoring/recompute-all?orgId=org-1', { method: 'POST' })
    })
  })

  it('warns when scoring config fails to load and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/scoring/config') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Scoring config unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<ScoringPage />)

    expect(await screen.findByRole('heading', { name: 'Scoring model could not load' })).toBeInTheDocument()
    expect(screen.getByText('Scoring config unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Scoring health')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save model' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Recompute all' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading scoring model' }))

    await waitFor(() => {
      const configRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/scoring/config'
      ))
      expect(configRequests).toHaveLength(2)
    })
  })

  it('turns incomplete scoring setup into direct model priority actions', async () => {
    render(<ScoringPage />)

    expect(await screen.findByText('Model setup priorities')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save model' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recompute all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review ICP' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tune lead weights' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable AI scoring' })).toBeInTheDocument()
    expect(screen.getByText('Define ICP fit')).toBeInTheDocument()
    expect(screen.getAllByText('Tune lead weights').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Enable AI supplement')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /tune lead weights/i }))
    expect(screen.getByText('Lead weights editor ready')).toBeInTheDocument()
  })

  it('names the strongest lead signal in readable sales language', async () => {
    render(<ScoringPage />)

    expect(await screen.findByText('Email replies')).toBeInTheDocument()
    expect(screen.queryByText('emailReplies')).not.toBeInTheDocument()
  })

  it('gives the AI scoring toggle a business-readable accessible name', async () => {
    render(<ScoringPage />)

    expect(await screen.findByRole('checkbox', { name: 'AI scoring' })).toBeInTheDocument()
  })

  it('uses an in-page confirmation before recomputing all contact scores', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<ScoringPage />)

    expect(await screen.findByText('Scoring command center')).toBeInTheDocument()
    expect(await screen.findByText('Model setup priorities')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Recompute all/i }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Recompute scores for all contacts?' })).toBeInTheDocument()
    expect(screen.getByText('This refreshes lead, ICP, and AI score outputs across the active CRM workspace. Team priority lists may change after it finishes.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/scoring/recompute-all', expect.any(Object))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm recompute all contact scores' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/scoring/recompute-all', { method: 'POST' })
    })
    expect(await screen.findByText('Done — 12 processed, 11 succeeded, 1 failed.')).toBeInTheDocument()

    confirmSpy.mockRestore()
  })
})
