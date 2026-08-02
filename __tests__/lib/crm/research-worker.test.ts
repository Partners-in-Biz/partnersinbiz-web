// __tests__/lib/crm/research-worker.test.ts
// Unit tests for processLeasedResearchTask (payload-backed enrichment)

jest.mock('@/lib/crm/facts/apply-mailbox', () => ({
  applyMailboxFactsToContact: jest.fn(),
}))

jest.mock('@/lib/crm/facts/record', () => ({
  recordContactFact: jest.fn(),
}))

jest.mock('@/lib/crm/facts/research-tasks', () => ({
  CRM_RESEARCH_TASKS_COLLECTION: 'crm_research_tasks',
  completeResearchTask: jest.fn(),
  leaseNextResearchTask: jest.fn(),
  listLeasableResearchTasks: jest.fn(),
}))

const mockContactGet = jest.fn()
const mockActivitiesAdd = jest.fn()
const mockFactsGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'contacts') {
        return {
          doc: jest.fn(() => ({
            get: mockContactGet,
          })),
        }
      }
      if (name === 'activities') {
        return { add: mockActivitiesAdd }
      }
      if (name === 'contact_facts') {
        return {
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: mockFactsGet,
        }
      }
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
        doc: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), update: jest.fn() })),
      }
    }),
    runTransaction: jest.fn(),
  },
}))

import { applyMailboxFactsToContact } from '@/lib/crm/facts/apply-mailbox'
import { recordContactFact } from '@/lib/crm/facts/record'
import { completeResearchTask } from '@/lib/crm/facts/research-tasks'
import { processLeasedResearchTask } from '@/lib/crm/facts/research-worker'
import type { CrmResearchTask } from '@/lib/crm/facts/research-tasks'

const mockMailbox = applyMailboxFactsToContact as jest.Mock
const mockRecord = recordContactFact as jest.Mock
const mockComplete = completeResearchTask as jest.Mock

function makeTask(overrides: Partial<CrmResearchTask> = {}): CrmResearchTask {
  return {
    id: 'task-1',
    orgId: 'org-a',
    kind: 'enrich_contact',
    status: 'leased',
    reason: 'Verify title from signature',
    contactId: 'contact-1',
    companyId: null,
    dealId: null,
    dueAt: new Date(),
    budgetUnits: 3,
    budgetSpent: 0,
    priority: 5,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockComplete.mockResolvedValue(undefined)
  mockActivitiesAdd.mockResolvedValue({ id: 'act-1' })
  mockFactsGet.mockResolvedValue({ docs: [] })
  mockContactGet.mockResolvedValue({
    exists: true,
    id: 'contact-1',
    data: () => ({
      orgId: 'org-a',
      name: 'Jane Doe',
      email: 'jane@acme.com',
      deleted: false,
    }),
  })
  mockMailbox.mockResolvedValue({
    dryRun: false,
    candidateCount: 0,
    storedCount: 0,
    candidates: [],
    results: [],
  })
  mockRecord.mockResolvedValue({
    stored: true,
    applied: false,
    band: 'PROBABLE',
    score: 0.7,
    rationale: 'ok',
  })
})

describe('processLeasedResearchTask', () => {
  it('fails closed when contact is missing', async () => {
    mockContactGet.mockResolvedValue({ exists: false })
    const result = await processLeasedResearchTask({
      task: makeTask(),
      workerId: 'worker-1',
    })
    expect(result.failed).toBe(true)
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        failed: true,
      }),
    )
  })

  it('applies mailbox bodyText from metadata', async () => {
    mockMailbox.mockResolvedValue({
      dryRun: false,
      candidateCount: 2,
      storedCount: 1,
      candidates: [],
      results: [{ field: 'title', value: 'CEO', result: { stored: true, applied: false } }],
    })
    const result = await processLeasedResearchTask({
      task: makeTask({
        kind: 'mailbox_identity',
        metadata: { bodyText: 'Jane Doe\nCEO\nAcme' },
      }),
      workerId: 'worker-1',
    })
    expect(result.ok).toBe(true)
    expect(result.factsStored).toBe(1)
    expect(mockMailbox).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-a',
        bodyText: 'Jane Doe\nCEO\nAcme',
        agentId: 'worker-1',
      }),
    )
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        failed: false,
        budgetSpentDelta: 1,
      }),
    )
    expect(mockActivitiesAdd).toHaveBeenCalled()
  })

  it('records observation payloads without model confidence', async () => {
    const result = await processLeasedResearchTask({
      task: makeTask({
        metadata: {
          observations: [
            {
              field: 'title',
              value: 'Head of Growth',
              evidence: [{ kind: 'crm.signature-block', detail: 'sig line' }],
            },
          ],
        },
      }),
      workerId: 'sage@mac',
    })
    expect(result.ok).toBe(true)
    expect(result.factsStored).toBe(1)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'title',
        value: 'Head of Growth',
        agentId: 'sage@mac',
        evidence: [{ kind: 'crm.signature-block', detail: 'sig line' }],
      }),
      expect.objectContaining({ id: 'contact-1', orgId: 'org-a' }),
    )
  })

  it('completes recheck without payload and notes open proposals', async () => {
    mockFactsGet.mockResolvedValue({
      docs: [{ data: () => ({ deleted: false }) }, { data: () => ({ deleted: false }) }],
    })
    const result = await processLeasedResearchTask({
      task: makeTask({ kind: 'recheck_contact', metadata: {} }),
      workerId: 'cron',
    })
    expect(result.ok).toBe(true)
    expect(result.resultSummary).toMatch(/open_proposals=2/)
    expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ failed: false }))
  })
})
