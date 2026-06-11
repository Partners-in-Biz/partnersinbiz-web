import { PATCH, DELETE } from '@/app/api/v1/ads/budgets/[id]/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/api/capabilityGate', () => ({ enforceAgentCapability: jest.fn(() => null) }))
jest.mock('@/lib/ads/budgets/store', () => ({
  getBudget: jest.fn(),
  updateBudget: jest.fn(),
  archiveBudget: jest.fn(),
  listEvents: jest.fn(),
}))
jest.mock('@/lib/ads/campaigns/store', () => ({ getCampaign: jest.fn() }))

const budgets = jest.requireMock('@/lib/ads/budgets/store')
const campaigns = jest.requireMock('@/lib/ads/campaigns/store')

const campaignBudget = {
  id: 'bud-1',
  orgId: 'org-1',
  scope: 'campaign',
  campaignId: 'cmp-1',
  platform: 'meta',
}

function req(body?: unknown) {
  return new Request('http://x', {
    method: body ? 'PATCH' : 'DELETE',
    headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as any
}

beforeEach(() => jest.clearAllMocks())

describe('budget mutation approval gates', () => {
  it('blocks budget updates when linked campaign is not approved', async () => {
    budgets.getBudget.mockResolvedValueOnce(campaignBudget)
    campaigns.getCampaign.mockResolvedValueOnce({ id: 'cmp-1', orgId: 'org-1', reviewState: 'awaiting' })

    const res = await PATCH(req({ capCents: 2000 }), { uid: 'admin-1' } as any, { params: Promise.resolve({ id: 'bud-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/persisted approval evidence/i)
    expect(budgets.updateBudget).not.toHaveBeenCalled()
  })

  it('rejects approval overrides on budget updates', async () => {
    budgets.getBudget.mockResolvedValueOnce(campaignBudget)

    const res = await PATCH(req({ capCents: 2000, approvedAt: { seconds: 1 } }), { uid: 'admin-1' } as any, { params: Promise.resolve({ id: 'bud-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/persisted records/i)
    expect(budgets.updateBudget).not.toHaveBeenCalled()
  })

  it('blocks budget archive when linked campaign is not approved', async () => {
    budgets.getBudget.mockResolvedValueOnce(campaignBudget)
    campaigns.getCampaign.mockResolvedValueOnce({ id: 'cmp-1', orgId: 'org-1', reviewState: 'draft' })

    const res = await DELETE(req(), { uid: 'admin-1' } as any, { params: Promise.resolve({ id: 'bud-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/persisted approval evidence/i)
    expect(budgets.archiveBudget).not.toHaveBeenCalled()
  })
})
