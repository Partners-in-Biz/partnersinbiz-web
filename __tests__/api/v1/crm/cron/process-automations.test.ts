// __tests__/api/v1/crm/cron/process-automations.test.ts
// Tests for the A6 process-automations cron endpoint.

// ─── Mocks (before imports) ───────────────────────────────────────────────────
jest.mock('@/lib/automations/store', () => ({
  getPendingDue: jest.fn(),
  markExecuted: jest.fn(),
  markFailed: jest.fn(),
  listRules: jest.fn(),
  createRule: jest.fn(),
  getRule: jest.fn(),
  updateRule: jest.fn(),
  deleteRule: jest.fn(),
  getMatchingRules: jest.fn(),
  queuePendingAutomation: jest.fn(),
}))

jest.mock('@/lib/automations/executor', () => ({
  executeActions: jest.fn(),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/crm/cron/process-automations/route'
import { getPendingDue, markExecuted, markFailed } from '@/lib/automations/store'
import { executeActions } from '@/lib/automations/executor'

const mockGetPendingDue = getPendingDue as jest.Mock
const mockMarkExecuted = markExecuted as jest.Mock
const mockMarkFailed = markFailed as jest.Mock
const mockExecuteActions = executeActions as jest.Mock

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers['authorization'] = authHeader
  return new NextRequest('http://localhost/api/v1/crm/cron/process-automations', { headers })
}

function makePendingItem(overrides: Partial<{
  id: string
  orgId: string
  contextDealId?: string
  contextContactId?: string
  contextContactEmail?: string
  contextOwnerEmail?: string
  actions: unknown[]
}> = {}) {
  return {
    id: overrides.id ?? 'pa-1',
    orgId: overrides.orgId ?? 'org-a',
    contextDealId: overrides.contextDealId ?? 'deal-1',
    contextContactId: overrides.contextContactId ?? 'contact-1',
    contextContactEmail: overrides.contextContactEmail ?? 'contact@example.com',
    contextOwnerEmail: overrides.contextOwnerEmail ?? 'owner@example.com',
    actions: overrides.actions ?? [{ type: 'send_email', emailTo: 'contact' }],
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'

  mockGetPendingDue.mockResolvedValue([])
  mockMarkExecuted.mockResolvedValue(undefined)
  mockMarkFailed.mockResolvedValue(undefined)
  mockExecuteActions.mockResolvedValue({ succeeded: 1, failed: 0, errors: [] })
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/v1/crm/cron/process-automations', () => {
  it('returns 401 when authorization header is missing', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header is wrong', async () => {
    const res = await GET(makeReq('Bearer wrong-token'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeReq('Bearer anything'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET not configured/i)
  })

  it('returns 200 with zero counts when no pending automations exist', async () => {
    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ processed: 0, succeeded: 0, failed: 0, errors: [] })
  })

  it('processes pending automations and returns correct counts', async () => {
    mockGetPendingDue.mockResolvedValue([
      makePendingItem({ id: 'pa-1' }),
      makePendingItem({ id: 'pa-2' }),
    ])
    mockExecuteActions.mockResolvedValue({ succeeded: 2, failed: 0, errors: [] })

    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.processed).toBe(2)
    expect(body.data.succeeded).toBe(4) // 2 items × 2 succeeded each
    expect(body.data.failed).toBe(0)
    expect(body.data.errors).toHaveLength(0)
  })

  it('calls markExecuted after successful executeActions', async () => {
    mockGetPendingDue.mockResolvedValue([makePendingItem({ id: 'pa-1' })])

    await GET(makeReq('Bearer test-secret'))

    expect(mockMarkExecuted).toHaveBeenCalledWith('pa-1')
  })

  it('calls markFailed and records error when executeActions throws', async () => {
    mockGetPendingDue.mockResolvedValue([makePendingItem({ id: 'pa-err' })])
    mockExecuteActions.mockRejectedValue(new Error('executor blew up'))

    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(mockMarkFailed).toHaveBeenCalledWith('pa-err', expect.stringContaining('executor blew up'))
    expect(body.data.failed).toBe(1)
    expect(body.data.errors).toHaveLength(1)
    expect(body.data.errors[0]).toMatch(/executor blew up/)
  })

  it('continues processing remaining items when one throws', async () => {
    mockGetPendingDue.mockResolvedValue([
      makePendingItem({ id: 'pa-1' }),
      makePendingItem({ id: 'pa-2' }),
      makePendingItem({ id: 'pa-3' }),
    ])
    mockExecuteActions
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValue({ succeeded: 1, failed: 0, errors: [] })

    const res = await GET(makeReq('Bearer test-secret'))
    const body = await res.json()

    expect(body.data.processed).toBe(3)
    expect(body.data.failed).toBe(1)
    expect(mockMarkExecuted).toHaveBeenCalledTimes(2)
    expect(mockMarkFailed).toHaveBeenCalledTimes(1)
  })

  it('collects action-level errors from executeActions result', async () => {
    mockGetPendingDue.mockResolvedValue([makePendingItem({ id: 'pa-1' })])
    mockExecuteActions.mockResolvedValue({
      succeeded: 0,
      failed: 1,
      errors: ['action[send_email]: SMTP failed'],
    })

    const res = await GET(makeReq('Bearer test-secret'))
    const body = await res.json()

    expect(body.data.errors).toContain('action[send_email]: SMTP failed')
    expect(mockMarkExecuted).toHaveBeenCalledWith('pa-1') // still marks executed
  })

  it('stops processing when time budget is exceeded', async () => {
    mockGetPendingDue.mockResolvedValue([
      makePendingItem({ id: 'pa-1' }),
      makePendingItem({ id: 'pa-2' }),
      makePendingItem({ id: 'pa-3' }),
    ])

    // The budget check runs at the TOP of each loop iteration (before processing).
    // callCount=1 → startedAt=0
    // callCount=2 → first item budget check → 0 (allow pa-1 to proceed)
    // callCount=3 → second item budget check → 56_000 (break before pa-2)
    let callCount = 0
    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount++
      if (callCount <= 2) return 0       // startedAt + first budget check = allow
      return 56_000                       // second budget check onwards = break
    })

    const res = await GET(makeReq('Bearer test-secret'))
    const body = await res.json()

    // First item processed, budget exceeded before second
    expect(body.data.processed).toBe(1)

    jest.spyOn(Date, 'now').mockRestore()
  })

  it('passes correct context fields to executeActions', async () => {
    mockGetPendingDue.mockResolvedValue([
      makePendingItem({
        id: 'pa-ctx',
        orgId: 'org-x',
        contextDealId: 'deal-x',
        contextContactId: 'contact-x',
        contextContactEmail: 'cx@test.com',
        contextOwnerEmail: 'owner-x@test.com',
      }),
    ])

    await GET(makeReq('Bearer test-secret'))

    expect(mockExecuteActions).toHaveBeenCalledWith(
      expect.any(Array),
      {
        orgId: 'org-x',
        dealId: 'deal-x',
        contactId: 'contact-x',
        contactEmail: 'cx@test.com',
        ownerEmail: 'owner-x@test.com',
      },
    )
  })
})
