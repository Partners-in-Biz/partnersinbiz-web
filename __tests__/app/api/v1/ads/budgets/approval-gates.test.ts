import { POST } from '@/app/api/v1/ads/budgets/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/api/capabilityGate', () => ({ enforceAgentCapability: jest.fn(() => null) }))
jest.mock('@/lib/ads/budgets/store', () => ({
  listBudgets: jest.fn(),
  createBudget: jest.fn(),
}))
jest.mock('@/lib/ads/campaigns/store', () => ({
  getCampaign: jest.fn(),
}))

const budgets = jest.requireMock('@/lib/ads/budgets/store')
const campaigns = jest.requireMock('@/lib/ads/campaigns/store')

beforeEach(() => jest.clearAllMocks())

function postBudget(body: unknown) {
  return POST(
    new Request('http://x', {
      method: 'POST',
      headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any,
    { uid: 'admin-1' } as any,
  )
}

describe('POST /api/v1/ads/budgets approval gates', () => {
  it('rejects caller-supplied approval state overrides', async () => {
    const res = await postBudget({
      input: { name: 'Budget', scope: 'campaign', period: 'monthly', capCents: 1000, campaignId: 'cmp-1', platform: 'meta', approvalState: 'approved' },
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/persisted records/i)
    expect(budgets.createBudget).not.toHaveBeenCalled()
  })

  it('blocks budget creation when the linked campaign is not approved', async () => {
    campaigns.getCampaign.mockResolvedValueOnce({ id: 'cmp-1', orgId: 'org-1', reviewState: 'awaiting' })

    const res = await postBudget({
      input: { name: 'Budget', scope: 'campaign', period: 'monthly', capCents: 1000, campaignId: 'cmp-1', platform: 'meta' },
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/persisted approval evidence/i)
    expect(budgets.createBudget).not.toHaveBeenCalled()
  })

  it('creates a budget only when linked to persisted campaign approval evidence', async () => {
    campaigns.getCampaign.mockResolvedValueOnce({ id: 'cmp-1', orgId: 'org-1', reviewState: 'approved', approvedAt: { seconds: 1 }, approvedBy: 'client-1' })
    budgets.createBudget.mockResolvedValueOnce({ id: 'bud-1', orgId: 'org-1' })

    const res = await postBudget({
      input: { name: 'Budget', scope: 'campaign', period: 'monthly', capCents: 1000, campaignId: 'cmp-1', platform: 'meta' },
    })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('bud-1')
    expect(budgets.createBudget).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }))
  })
})
