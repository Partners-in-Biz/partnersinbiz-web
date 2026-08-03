/**
 * Regression: GET /workflow-runs?status=all must enumerate the full ledger.
 * Prior bug queried Firestore where status == "all" → items=[].
 */

const whereCalls: Array<[string, string, unknown]> = []

function makeQuery() {
  const query = {
    where: jest.fn((field: string, op: string, value: unknown) => {
      whereCalls.push([field, op, value])
      return query
    }),
    limit: jest.fn(() => query),
    get: jest.fn(async () => ({
      empty: false,
      docs: [
        {
          id: 'wfr_succeeded',
          data: () => ({
            orgId: 'org-a',
            status: 'succeeded',
            nodes: [],
            cost: { tokensTotal: 1, budgetStatus: 'within_budget' },
            updatedAt: '2026-08-03T00:00:00.000Z',
            templateId: 't1',
          }),
        },
        {
          id: 'wfr_failed',
          data: () => ({
            orgId: 'org-a',
            status: 'failed',
            nodes: [],
            cost: { tokensTotal: 2, budgetStatus: 'within_budget' },
            updatedAt: '2026-08-03T00:01:00.000Z',
            templateId: 't1',
            blockedReasonCode: 'missing_artifact:x',
          }),
        },
        {
          id: 'wfr_cancelled',
          data: () => ({
            orgId: 'org-a',
            status: 'cancelled',
            nodes: [],
            cost: { tokensTotal: 0, budgetStatus: 'within_budget' },
            updatedAt: '2026-08-03T00:02:00.000Z',
            templateId: 't1',
          }),
        },
      ],
    })),
  }
  return query
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => makeQuery()),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...args: unknown[]) => args),
  },
}))

import { listWorkflowRuns } from '@/lib/workflow-graph/store'
import { listOpsWorkflowRuns } from '@/lib/workflow-graph/service'

describe('workflow-runs status=all ledger filter', () => {
  beforeEach(() => {
    whereCalls.length = 0
    jest.clearAllMocks()
  })

  test('listWorkflowRuns status=all does not constrain Firestore status field', async () => {
    const runs = await listWorkflowRuns({ orgId: 'org-a', status: 'all', limit: 50 })
    expect(runs.map((r) => r.id).sort()).toEqual(['wfr_cancelled', 'wfr_failed', 'wfr_succeeded'])
    expect(whereCalls).toEqual([['orgId', '==', 'org-a']])
    expect(whereCalls.some((c) => c[0] === 'status' && c[2] === 'all')).toBe(false)
  })

  test('listWorkflowRuns omitted status matches status=all (unfiltered)', async () => {
    const unfiltered = await listWorkflowRuns({ orgId: 'org-a', limit: 50 })
    whereCalls.length = 0
    const allAlias = await listWorkflowRuns({ orgId: 'org-a', status: 'all', limit: 50 })
    expect(allAlias.map((r) => r.id).sort()).toEqual(unfiltered.map((r) => r.id).sort())
    expect(whereCalls.some((c) => c[0] === 'status')).toBe(false)
  })

  test('listWorkflowRuns status=succeeded still filters stored status', async () => {
    await listWorkflowRuns({ orgId: 'org-a', status: 'succeeded', limit: 50 })
    expect(whereCalls).toContainEqual(['orgId', '==', 'org-a'])
    expect(whereCalls).toContainEqual(['status', '==', 'succeeded'])
  })

  test('listOpsWorkflowRuns status=all returns terminal + non-ops-bucket runs', async () => {
    const out = await listOpsWorkflowRuns({
      orgId: 'org-a',
      status: 'all',
      limit: 50,
      now: '2026-08-03T12:00:00.000Z',
    })
    expect(out.items.length).toBe(3)
    expect(out.items.map((i) => i.runId).sort()).toEqual([
      'wfr_cancelled',
      'wfr_failed',
      'wfr_succeeded',
    ])
    // Response path should still expose ops counts without dropping ledger rows
    expect(out.counts.blocked).toBeGreaterThanOrEqual(1)
  })
})
