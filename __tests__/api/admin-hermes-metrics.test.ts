import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockLimit = jest.fn(() => ({ get: mockGet }))
const mockCollection = jest.fn(() => ({ limit: mockLimit }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) => handler,
}))

function runDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

describe('GET /api/v1/admin/hermes/metrics', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockCollection.mockReturnValue({ limit: mockLimit })
    mockLimit.mockReturnValue({ get: mockGet })
  })

  it('labels missing runtime cost as unavailable instead of silently returning a null cost', async () => {
    mockGet.mockResolvedValue({
      docs: [
        runDoc('run-1', {
          profile: 'theo',
          status: 'completed',
          createdAt: '2026-07-06T08:00:00.000Z',
          completedAt: '2026-07-06T08:01:00.000Z',
          response: {
            status: 'completed',
            provider: 'openai',
            model: 'gpt-5.5',
            usage: {
              input_tokens: 1_000_000,
              output_tokens: 25_000,
              total_tokens: 1_025_000,
            },
          },
        }),
      ],
    })

    const { GET } = await import('@/app/api/v1/admin/hermes/metrics/route')
    const req = new NextRequest('http://localhost/api/v1/admin/hermes/metrics?agentId=theo&days=30')
    const res = await GET(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.data.summary.totalCostUsd).toBeNull()
    expect(json.data.summary.costSource).toBe('unavailable')
    expect(json.data.summary.costUnavailableReason).toBe('cost_usd_unavailable_from_hermes')
    expect(json.data.summary.runsMissingCost).toBe(1)
    expect(json.data.agents[0]).toEqual(expect.objectContaining({
      agentId: 'theo',
      providerModels: [{ provider: 'openai', model: 'gpt-5.5', runs: 1 }],
      cost: expect.objectContaining({
        usd: null,
        source: 'unavailable',
        unavailableReason: 'cost_usd_unavailable_from_hermes',
        runsWithCost: 0,
        runsMissingCost: 1,
      }),
      tokens: expect.objectContaining({
        total: 1_025_000,
        source: 'upstream',
      }),
    }))
  })

  it('keeps upstream cost as the cost source when Hermes exposes cost_usd', async () => {
    mockGet.mockResolvedValue({
      docs: [
        runDoc('run-1', {
          profile: 'theo-main',
          status: 'completed',
          createdAt: '2026-07-06T08:00:00.000Z',
          completedAt: '2026-07-06T08:01:00.000Z',
          response: {
            status: 'completed',
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            usage: {
              input_tokens: 2_000,
              output_tokens: 500,
              total_tokens: 2_500,
              cost_usd: 0.0875,
            },
          },
        }),
      ],
    })

    const { GET } = await import('@/app/api/v1/admin/hermes/metrics/route')
    const req = new NextRequest('http://localhost/api/v1/admin/hermes/metrics?agentId=theo&days=30')
    const res = await GET(req)
    const json = await res.json()

    expect(json.data.summary.totalCostUsd).toBe(0.0875)
    expect(json.data.summary.costSource).toBe('upstream')
    expect(json.data.summary.runsMissingCost).toBe(0)
    expect(json.data.agents[0].cost).toEqual(expect.objectContaining({
      usd: 0.0875,
      source: 'upstream',
      unavailableReason: null,
      runsWithCost: 1,
      runsMissingCost: 0,
    }))
  })
})
