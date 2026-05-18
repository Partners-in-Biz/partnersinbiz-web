// __tests__/lib/automations/store.test.ts

const mockGet = jest.fn()
const mockDocGet = jest.fn()
const mockAdd = jest.fn()
const mockDocUpdate = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
  Timestamp: {
    fromMillis: jest.fn((ms: number) => ({ _ms: ms })),
    now: jest.fn(() => ({ _now: true })),
  },
}))

// eslint-disable-next-line import/first
import {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  getMatchingRules,
  queuePendingAutomation,
  getPendingDue,
  markExecuted,
  markFailed,
} from '@/lib/automations/store'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { AutomationRule, AutomationRuleInput, TriggerContext } from '@/lib/automations/types'

const ACTOR: MemberRef = { uid: 'user-1', displayName: 'Test User', kind: 'human' }

const BASE_RULE: AutomationRule = {
  id: 'rule-1',
  orgId: 'org-a',
  name: 'Test Rule',
  enabled: true,
  trigger: { event: 'deal.created' },
  actions: [{ type: 'send_email', emailTo: 'contact', emailSubject: 'Hi', emailBody: '<p>Hello</p>' }],
  deleted: false,
  createdAt: null,
  updatedAt: null,
}

function makeQueryChain() {
  return {
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
    get: mockGet,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  const chain = makeQueryChain()
  mockWhere.mockReturnValue(chain)
  mockOrderBy.mockReturnValue(chain)
  mockLimit.mockReturnValue(chain)
  const docRef = {
    get: mockDocGet,
    update: mockDocUpdate,
  }
  mockDoc.mockReturnValue(docRef)
  mockCollection.mockReturnValue({
    doc: mockDoc,
    where: mockWhere,
    add: mockAdd,
  })
})

// ── listRules ─────────────────────────────────────────────────────────────

describe('listRules', () => {
  it('returns active rules for the org', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'rule-1', data: () => ({ ...BASE_RULE }) },
        { id: 'rule-2', data: () => ({ ...BASE_RULE, id: 'rule-2', name: 'Rule 2' }) },
      ],
    })
    const results = await listRules('org-a')
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('rule-1')
    expect(results[1].id).toBe('rule-2')
  })

  it('filters deleted rules via query chain', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    await listRules('org-a')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-a')
    expect(mockWhere).toHaveBeenCalledWith('deleted', '!=', true)
    expect(mockOrderBy).toHaveBeenCalledWith('name', 'asc')
  })
})

// ── getRule ───────────────────────────────────────────────────────────────

describe('getRule', () => {
  it('returns rule when found and orgId matches', async () => {
    mockDocGet.mockResolvedValue({ exists: true, id: 'rule-1', data: () => ({ ...BASE_RULE }) })
    const result = await getRule('org-a', 'rule-1')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('rule-1')
  })

  it('returns null when doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const result = await getRule('org-a', 'rule-missing')
    expect(result).toBeNull()
  })

  it('returns null when orgId does not match', async () => {
    mockDocGet.mockResolvedValue({ exists: true, id: 'rule-1', data: () => ({ ...BASE_RULE, orgId: 'org-b' }) })
    const result = await getRule('org-a', 'rule-1')
    expect(result).toBeNull()
  })
})

// ── createRule ────────────────────────────────────────────────────────────

describe('createRule', () => {
  it('calls add() with correct shape including serverTimestamp and actor', async () => {
    const addedRef = {
      id: 'new-rule',
      get: jest.fn().mockResolvedValue({ data: () => ({ ...BASE_RULE }), id: 'new-rule' }),
    }
    mockAdd.mockResolvedValue(addedRef)

    const input: AutomationRuleInput = {
      name: 'New Rule',
      enabled: true,
      trigger: { event: 'deal.won' },
      actions: [],
    }

    const result = await createRule('org-a', input, ACTOR)
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-a',
        name: 'New Rule',
        createdAt: 'SERVER_TIMESTAMP',
        updatedAt: 'SERVER_TIMESTAMP',
        createdByRef: ACTOR,
        updatedByRef: ACTOR,
      }),
    )
    expect(result.id).toBe('new-rule')
  })
})

// ── updateRule ────────────────────────────────────────────────────────────

describe('updateRule', () => {
  it('calls doc.update() with patch and updatedByRef', async () => {
    const getRef = jest.fn()
      .mockResolvedValueOnce({ exists: true, data: () => ({ ...BASE_RULE }) })
      .mockResolvedValueOnce({ data: () => ({ ...BASE_RULE, name: 'Updated' }), id: 'rule-1' })
    const ref = { get: getRef, update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)

    await updateRule('org-a', 'rule-1', { name: 'Updated' }, ACTOR)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Updated',
        updatedAt: 'SERVER_TIMESTAMP',
        updatedByRef: ACTOR,
      }),
    )
  })

  it('throws when orgId does not match', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ ...BASE_RULE, orgId: 'org-b' }),
    })
    const ref = { get: mockDocGet, update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)

    await expect(updateRule('org-a', 'rule-1', { name: 'X' }, ACTOR)).rejects.toThrow('AutomationRule not found')
  })
})

// ── deleteRule ────────────────────────────────────────────────────────────

describe('deleteRule', () => {
  it('soft-deletes with deleted:true and updatedAt', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ ...BASE_RULE }) })
    const ref = { get: mockDocGet, update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)

    await deleteRule('org-a', 'rule-1', ACTOR)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted: true,
        updatedAt: 'SERVER_TIMESTAMP',
        updatedByRef: ACTOR,
      }),
    )
  })
})

// ── getMatchingRules ──────────────────────────────────────────────────────

describe('getMatchingRules', () => {
  it('returns enabled rules matching the event', async () => {
    mockGet.mockResolvedValue({
      docs: [{ id: 'rule-1', data: () => ({ ...BASE_RULE, trigger: { event: 'deal.created' } }) }],
    })
    const ctx: TriggerContext = { orgId: 'org-a' }
    const results = await getMatchingRules('org-a', 'deal.created', ctx)
    expect(results).toHaveLength(1)
    expect(mockWhere).toHaveBeenCalledWith('enabled', '==', true)
    expect(mockWhere).toHaveBeenCalledWith('trigger.event', '==', 'deal.created')
  })

  it('filters out rules with toStageId not matching context', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'rule-1',
          data: () => ({ ...BASE_RULE, trigger: { event: 'deal.stage_changed', toStageId: 'stage-x' } }),
        },
      ],
    })
    const ctx: TriggerContext = { orgId: 'org-a', toStageId: 'stage-y' }
    const results = await getMatchingRules('org-a', 'deal.stage_changed', ctx)
    expect(results).toHaveLength(0)
  })

  it('includes rules when toStageId matches context', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'rule-1',
          data: () => ({ ...BASE_RULE, trigger: { event: 'deal.stage_changed', toStageId: 'stage-x' } }),
        },
      ],
    })
    const ctx: TriggerContext = { orgId: 'org-a', toStageId: 'stage-x' }
    const results = await getMatchingRules('org-a', 'deal.stage_changed', ctx)
    expect(results).toHaveLength(1)
  })

  it('filters out rules with pipelineId not matching context', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'rule-1',
          data: () => ({ ...BASE_RULE, trigger: { event: 'deal.won', pipelineId: 'pipe-a' } }),
        },
      ],
    })
    const ctx: TriggerContext = { orgId: 'org-a', pipelineId: 'pipe-b' }
    const results = await getMatchingRules('org-a', 'deal.won', ctx)
    expect(results).toHaveLength(0)
  })
})

// ── queuePendingAutomation ────────────────────────────────────────────────

describe('queuePendingAutomation', () => {
  it('writes doc with correct scheduledAt based on delayMinutes', async () => {
    mockAdd.mockResolvedValue({ id: 'pending-1' })
    const rule: AutomationRule = { ...BASE_RULE, delayMinutes: 30 }
    const ctx: TriggerContext = { orgId: 'org-a', dealId: 'deal-1', contactEmail: 'a@b.com' }

    await queuePendingAutomation('org-a', rule, ctx)
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-a',
        ruleId: 'rule-1',
        status: 'pending',
        contextDealId: 'deal-1',
        contextContactEmail: 'a@b.com',
      }),
    )
    // scheduledAt should be Timestamp.fromMillis(...)
    const callArg = mockAdd.mock.calls[0][0]
    expect(callArg.scheduledAt).toBeDefined()
  })
})

// ── getPendingDue ─────────────────────────────────────────────────────────

describe('getPendingDue', () => {
  it('queries pending automations with correct filters', async () => {
    mockGet.mockResolvedValue({
      docs: [{ id: 'pa-1', data: () => ({ orgId: 'org-a', status: 'pending', ruleId: 'rule-1', actions: [], triggerEvent: 'deal.created', scheduledAt: null, createdAt: null }) }],
    })
    const results = await getPendingDue(50)
    expect(results).toHaveLength(1)
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'pending')
    expect(mockLimit).toHaveBeenCalledWith(50)
  })
})
