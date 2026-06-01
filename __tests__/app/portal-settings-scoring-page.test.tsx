import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ScoringPage from '@/app/(portal)/portal/settings/scoring/page'

jest.mock('@/components/crm/IcpProfileEditor', () => ({
  IcpProfileEditor: () => <div>ICP editor ready</div>,
}))

jest.mock('@/components/crm/LeadWeightsEditor', () => ({
  LeadWeightsEditor: () => <div>Lead weights editor ready</div>,
}))

describe('Portal settings scoring page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
