// __tests__/api/v1/ads/budgets/routes.test.ts
// 8 tests covering GET/POST /budgets, GET/PATCH/DELETE /budgets/[id],
// POST /budgets/[id]/check, POST /budgets/[id]/reset

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) => handler,
}))

// ─── Store mock ───────────────────────────────────────────────────────────────
jest.mock('@/lib/ads/budgets/store', () => ({
  listBudgets: jest.fn(),
  createBudget: jest.fn(),
  getBudget: jest.fn(),
  updateBudget: jest.fn(),
  archiveBudget: jest.fn(),
  listEvents: jest.fn(),
  computeWindowStart: jest.fn(),
  updateBudgetTracking: jest.fn(),
  appendEvent: jest.fn(),
  resetBudgetForNewPeriod: jest.fn(),
}))

// ─── Pacing mock ─────────────────────────────────────────────────────────────
jest.mock('@/lib/ads/budgets/pacing', () => ({
  sumSpendInScope: jest.fn(),
  computeCheck: jest.fn(),
}))

// ─── Auto-pause mock ─────────────────────────────────────────────────────────
jest.mock('@/lib/ads/budgets/auto-pause', () => ({
  autoPauseCampaignsInScope: jest.fn(),
}))

// ─── Firebase admin mock ─────────────────────────────────────────────────────
jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1234567890, nanoseconds: 0 })),
  },
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { GET as listGET, POST as createPOST } from '@/app/api/v1/ads/budgets/route'
import {
  GET as detailGET,
  PATCH as detailPATCH,
  DELETE as detailDELETE,
} from '@/app/api/v1/ads/budgets/[id]/route'
import { POST as checkPOST } from '@/app/api/v1/ads/budgets/[id]/check/route'
import { POST as resetPOST } from '@/app/api/v1/ads/budgets/[id]/reset/route'

const {
  listBudgets,
  createBudget,
  getBudget,
  updateBudget,
  archiveBudget,
  listEvents,
  computeWindowStart,
  updateBudgetTracking,
  appendEvent,
  resetBudgetForNewPeriod,
} = jest.requireMock('@/lib/ads/budgets/store')

const { sumSpendInScope, computeCheck } = jest.requireMock('@/lib/ads/budgets/pacing')
const { autoPauseCampaignsInScope } = jest.requireMock('@/lib/ads/budgets/auto-pause')

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fakeTs = { seconds: 1000000, nanoseconds: 0 }

const fakeBudget = {
  id: 'bgt_abc123',
  orgId: 'org-001',
  name: 'Monthly Budget',
  scope: 'org' as const,
  period: 'monthly' as const,
  capCents: 100_000,
  currencyCode: 'USD',
  periodStart: fakeTs,
  alertThresholds: [75, 90, 100],
  autoPause: false,
  autoResumeOnRollover: false,
  createdBy: 'user-001',
  createdAt: fakeTs,
  updatedAt: fakeTs,
  firedThresholds: [],
}

function makeReq(
  url: string,
  opts: { method?: string; body?: unknown; orgId?: string } = {},
): Request {
  return new Request(`http://localhost${url}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Org-Id': opts.orgId ?? 'org-001',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
}

function fakeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  listBudgets.mockResolvedValue([fakeBudget])
  createBudget.mockResolvedValue(fakeBudget)
  getBudget.mockResolvedValue(fakeBudget)
  updateBudget.mockResolvedValue(undefined)
  archiveBudget.mockResolvedValue(undefined)
  listEvents.mockResolvedValue([])
  computeWindowStart.mockReturnValue(fakeTs)
  updateBudgetTracking.mockResolvedValue(undefined)
  appendEvent.mockResolvedValue({})
  resetBudgetForNewPeriod.mockResolvedValue(undefined)
  sumSpendInScope.mockResolvedValue(0)
  computeCheck.mockReturnValue({
    spendCents: 0,
    percent: 0,
    newThresholds: [],
    exhausted: false,
    shouldAutoPause: false,
  })
  autoPauseCampaignsInScope.mockResolvedValue([])
})

// ─── Test 1: GET / lists budgets for org ─────────────────────────────────────
describe('GET /api/v1/ads/budgets', () => {
  it('lists budgets for the org', async () => {
    const res = await (listGET as Function)(makeReq('/api/v1/ads/budgets'), { uid: 'user-001', role: 'admin' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('bgt_abc123')
    expect(listBudgets).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-001' }),
    )
  })
})

// ─── Test 2: POST / creates budget ────────────────────────────────────────────
describe('POST /api/v1/ads/budgets', () => {
  it('creates a budget with correct args', async () => {
    const input = {
      name: 'New Budget',
      scope: 'org',
      period: 'monthly',
      capCents: 50_000,
    }
    const res = await (createPOST as Function)(
      makeReq('/api/v1/ads/budgets', { method: 'POST', body: { input } }),
      { uid: 'user-001', role: 'admin' },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(createBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-001',
        createdBy: 'user-001',
        input,
      }),
    )
  })

  // ─── Test 3: POST / returns 400 on missing required fields ──────────────────
  it('returns 400 when required fields are missing', async () => {
    const res = await (createPOST as Function)(
      makeReq('/api/v1/ads/budgets', { method: 'POST', body: { input: { name: 'Incomplete' } } }),
      { uid: 'user-001', role: 'admin' },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/missing required fields/i)
  })
})

// ─── Test 4: GET /[id] returns budget + events; 404 if not found ──────────────
describe('GET /api/v1/ads/budgets/[id]', () => {
  it('returns budget and events for the correct org', async () => {
    listEvents.mockResolvedValue([{ id: 'evt_001', type: 'pacing_check' }])
    const res = await (detailGET as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123'),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.budget.id).toBe('bgt_abc123')
    expect(body.data.events).toHaveLength(1)
  })

  it('returns 404 when budget belongs to different org', async () => {
    getBudget.mockResolvedValue({ ...fakeBudget, orgId: 'org-other' })
    const res = await (detailGET as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123'),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(404)
  })
})

// ─── Test 5: PATCH /[id] updates budget; 404 cross-tenant ────────────────────
describe('PATCH /api/v1/ads/budgets/[id]', () => {
  it('updates the budget and returns updated doc', async () => {
    const updated = { ...fakeBudget, capCents: 200_000 }
    // First call returns existing, second call returns updated
    getBudget.mockResolvedValueOnce(fakeBudget).mockResolvedValueOnce(updated)
    const res = await (detailPATCH as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123', { method: 'PATCH', body: { capCents: 200_000 } }),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(200)
    expect(updateBudget).toHaveBeenCalledWith('bgt_abc123', { capCents: 200_000 })
    const body = await res.json()
    expect(body.data.capCents).toBe(200_000)
  })

  it('returns 404 when budget belongs to different org', async () => {
    getBudget.mockResolvedValue({ ...fakeBudget, orgId: 'org-other' })
    const res = await (detailPATCH as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123', { method: 'PATCH', body: { capCents: 999 } }),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(404)
  })
})

// ─── Test 6: DELETE /[id] archives; 404 cross-tenant ─────────────────────────
describe('DELETE /api/v1/ads/budgets/[id]', () => {
  it('archives the budget and returns { archived: true }', async () => {
    const res = await (detailDELETE as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123', { method: 'DELETE' }),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(200)
    expect(archiveBudget).toHaveBeenCalledWith('bgt_abc123')
    const body = await res.json()
    expect(body.data.archived).toBe(true)
  })

  it('returns 404 when budget belongs to different org', async () => {
    getBudget.mockResolvedValue({ ...fakeBudget, orgId: 'org-other' })
    const res = await (detailDELETE as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123', { method: 'DELETE' }),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(404)
  })
})

// ─── Test 7: POST /[id]/check fires threshold alerts when new ─────────────────
describe('POST /api/v1/ads/budgets/[id]/check', () => {
  it('fires threshold_alert events for newly crossed thresholds', async () => {
    sumSpendInScope.mockResolvedValue(80_000)
    computeCheck.mockReturnValue({
      spendCents: 80_000,
      percent: 80,
      newThresholds: [75],
      exhausted: false,
      shouldAutoPause: false,
    })

    const res = await (checkPOST as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123/check', { method: 'POST' }),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.newThresholds).toEqual([75])
    expect(body.data.percent).toBe(80)

    // threshold_alert event should have been appended
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'threshold_alert', threshold: 75, budgetId: 'bgt_abc123' }),
    )
    // regular pacing_check should NOT be appended (we had new thresholds)
    const pacingCheckCalls = (appendEvent as jest.Mock).mock.calls.filter(
      ([a]: [{ type: string }]) => a.type === 'pacing_check',
    )
    expect(pacingCheckCalls).toHaveLength(0)
  })

  it('calls autoPauseCampaignsInScope when shouldAutoPause is true', async () => {
    sumSpendInScope.mockResolvedValue(100_000)
    computeCheck.mockReturnValue({
      spendCents: 100_000,
      percent: 100,
      newThresholds: [100],
      exhausted: true,
      shouldAutoPause: true,
    })
    autoPauseCampaignsInScope.mockResolvedValue(['camp-001', 'camp-002'])

    const res = await (checkPOST as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123/check', { method: 'POST' }),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.pausedCampaignIds).toEqual(['camp-001', 'camp-002'])
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auto_paused', pausedCampaignIds: ['camp-001', 'camp-002'] }),
    )
  })
})

// ─── Test 8: POST /[id]/reset calls resetBudgetForNewPeriod + reset event ─────
describe('POST /api/v1/ads/budgets/[id]/reset', () => {
  it('resets the budget period and appends a reset event', async () => {
    const newTs = { seconds: 2000000, nanoseconds: 0 }
    computeWindowStart.mockReturnValue(newTs)

    const res = await (resetPOST as Function)(
      makeReq('/api/v1/ads/budgets/bgt_abc123/reset', { method: 'POST' }),
      { uid: 'user-001', role: 'admin' },
      fakeCtx('bgt_abc123'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.reset).toBe(true)

    expect(resetBudgetForNewPeriod).toHaveBeenCalledWith({
      budgetId: 'bgt_abc123',
      newPeriodStart: newTs,
    })
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ budgetId: 'bgt_abc123', type: 'reset', spendCents: 0, percent: 0 }),
    )
  })
})
