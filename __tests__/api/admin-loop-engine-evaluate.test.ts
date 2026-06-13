import { NextRequest } from 'next/server'

const mockCanAccessOrg = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockTaskCollection = jest.fn()
const mockTaskDoc = jest.fn()
const mockSet = jest.fn()
const mockRunDoc = jest.fn()
const mockRunSet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest) =>
    handler(req, { uid: 'admin-1', role: 'admin', allowedOrgIds: [], agentId: 'pip' }),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockCanAccessOrg.mockReturnValue(true)
  mockSet.mockResolvedValue(undefined)
  mockRunSet.mockResolvedValue(undefined)
  mockRunDoc.mockImplementation((runId: string) => ({ id: runId, set: mockRunSet }))
  mockTaskDoc.mockImplementation((taskId: string) => ({ id: taskId, set: mockSet }))
  mockTaskCollection.mockImplementation((collectionName: string) => {
    if (collectionName !== 'tasks') throw new Error(`Unexpected nested collection ${collectionName}`)
    return { doc: mockTaskDoc }
  })
  mockProjectDoc.mockImplementation((projectId: string) => ({ id: projectId, collection: mockTaskCollection }))
  mockCollection.mockImplementation((collectionName: string) => {
    if (collectionName === 'projects') return { doc: mockProjectDoc }
    if (collectionName === 'loop_engine_runs') return { doc: mockRunDoc }
    throw new Error(`Unexpected collection ${collectionName}`)
  })
})

describe('POST /api/v1/admin/loop-engine/evaluate', () => {
  it('builds and persists conservative review tasks from explicit business signals', async () => {
    const { POST } = await import('@/app/api/v1/admin/loop-engine/evaluate/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/admin/loop-engine/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        projectId: 'growth-project',
        loopId: 'business-insight-review',
        dryRun: true,
        persist: false,
        persistReviewTasks: true,
        sourceWindow: {
          from: '2026-06-06T00:00:00.000Z',
          to: '2026-06-13T00:00:00.000Z',
        },
        businessSignals: [
          {
            id: 'crm-gap-1',
            lane: 'crm',
            insightKind: 'follow-up-gap',
            summary: 'Three high-intent CRM leads have no owner or next action.',
            impactEstimate: 'Potential response-time revenue leakage',
            metric: 'unowned_high_intent_leads',
            value: 3,
            impact: 82,
            urgency: 88,
            confidence: 78,
            actionability: 90,
            risk: 30,
            ownerAgentId: 'sales',
            ownerRole: 'sales',
            nextAction: 'Assign sales to triage the leads and create a follow-up task.',
            suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
            sourceLinks: [{ type: 'contact', id: 'contact-1', href: '/admin/crm/contacts/contact-1', label: 'Contact 1' }],
            evidence: [{ label: 'High-intent leads without owner', value: 3 }],
            hasNewSourceItem: true,
          },
        ],
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.reviewDrafts).toHaveLength(1)
    expect(body.data.reviewDrafts[0]).toMatchObject({
      loopId: 'business-insight-review',
      projectId: 'growth-project',
      sideEffectPolicy: 'internal-review-only',
    })
    expect(body.data.reviewTaskPersistence.created).toEqual([
      expect.objectContaining({
        draftId: body.data.reviewDrafts[0].idempotencyKey,
        projectId: 'growth-project',
        loopId: 'business-insight-review',
      }),
    ])
    expect(mockProjectDoc).toHaveBeenCalledWith('growth-project')
    expect(mockTaskDoc).toHaveBeenCalledWith(body.data.reviewTaskPersistence.created[0].taskId)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'review',
      reviewStatus: 'pending',
      requiresApproval: true,
      metadata: expect.objectContaining({
        businessInsightReview: expect.objectContaining({ type: 'business-insight-review' }),
      }),
    }), { merge: true })
  })

  it('persists loop-run telemetry and preserves supplied finance approval gates', async () => {
    const { POST } = await import('@/app/api/v1/admin/loop-engine/evaluate/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/admin/loop-engine/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        projectId: 'finance-project',
        loopId: 'business-insight-review',
        dryRun: true,
        persist: true,
        persistReviewTasks: true,
        sourceWindow: {
          from: '2026-06-06T00:00:00.000Z',
          to: '2026-06-13T00:00:00.000Z',
        },
        businessSignals: [
          {
            id: 'invoice-overdue-value-pib-platform-owner',
            lane: 'invoice',
            insightKind: 'risk',
            summary: '45000 overdue invoice value needs finance review',
            impactEstimate: 'Cash-flow and client-account risk from overdue invoices',
            metric: 'invoices_overdue_value',
            value: 45000,
            impact: 90,
            urgency: 92,
            confidence: 88,
            actionability: 84,
            risk: 34,
            ownerAgentId: 'pip',
            ownerRole: 'finance',
            approvalGate: 'finance',
            nextAction: 'Review overdue invoices and create internal finance follow-up.',
            suppressionKey: 'invoice:overdue-value:pib-platform-owner',
            sourceLinks: [{ type: 'invoice', id: 'inv-1', href: '/admin/invoicing/inv-1', label: 'INV-1' }],
            evidence: [{ label: 'Overdue invoice value', value: 45000 }],
            hasNewSourceItem: true,
          },
        ],
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.reviewDrafts).toHaveLength(1)
    expect(body.data.reviewDrafts[0].metadata.businessInsightReview.recommendation).toMatchObject({
      approvalGate: 'finance',
    })
    expect(mockRunSet).toHaveBeenCalledWith(expect.objectContaining({
      loopId: 'business-insight-review',
      usage: expect.objectContaining({
        durationMs: expect.any(Number),
        retryCount: 0,
        toolCallCount: 0,
      }),
      runtime: expect.objectContaining({
        source: 'admin-loop-engine-evaluate',
        durationMs: expect.any(Number),
        candidateCount: 0,
        reviewDraftCount: 1,
        persistedReviewTaskCount: 1,
      }),
      telemetry: expect.objectContaining({
        source: 'admin-loop-engine-evaluate',
        durationMs: expect.any(Number),
      }),
    }), { merge: true })
  })
})
