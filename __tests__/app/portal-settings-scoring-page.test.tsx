import { fireEvent, render, screen } from '@testing-library/react'
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
    global.fetch = jest.fn((input: RequestInfo | URL) => {
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
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns incomplete scoring setup into direct model priority actions', async () => {
    render(<ScoringPage />)

    expect(await screen.findByText('Model setup priorities')).toBeInTheDocument()
    expect(screen.getByText('Define ICP fit')).toBeInTheDocument()
    expect(screen.getAllByText('Tune lead weights').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Enable AI supplement')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /tune lead weights/i }))
    expect(screen.getByText('Lead weights editor ready')).toBeInTheDocument()
  })
})
