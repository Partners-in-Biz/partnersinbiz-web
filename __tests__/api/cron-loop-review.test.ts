import { NextRequest } from 'next/server'

const mockCollectLoopReviewSignals = jest.fn()
const mockMeasureBusinessInsightOutcomes = jest.fn()
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

jest.mock('@/lib/loop-engine/live-signal-collector', () => ({
  collectLoopReviewSignals: (...args: unknown[]) => mockCollectLoopReviewSignals(...args),
}))

jest.mock('@/lib/loop-engine/business-insight-outcomes', () => ({
  measureBusinessInsightOutcomes: (...args: unknown[]) => mockMeasureBusinessInsightOutcomes(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CRON_SECRET
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
  mockCollectLoopReviewSignals.mockResolvedValue({
    scanned: 1,
    sourceWindow: {
      from: '2026-06-06T00:00:00.000Z',
      to: '2026-06-13T00:00:00.000Z',
    },
    agentSignals: [],
    businessSignals: [
      {
        id: 'task-risk-1',
        lane: 'project',
        insightKind: 'risk',
        summary: 'High-risk work is blocked: Client launch',
        impactEstimate: 'Potential client delivery or revenue risk',
        impact: 86,
        urgency: 88,
        confidence: 72,
        actionability: 76,
        risk: 30,
        nextAction: 'Review the blocked work and assign an owner.',
        suppressionKey: 'project-risk:pib-platform-owner:task-1',
        sourceLinks: [{ type: 'task', id: 'task-1', href: '/admin/projects/growth-project?task=task-1', label: 'Client launch' }],
        evidence: [{ label: 'Task state', value: 'blocked' }],
        hasNewSourceItem: true,
      },
    ],
    existingSuppressionKeys: [],
  })
  mockMeasureBusinessInsightOutcomes.mockResolvedValue({
    scanned: 2,
    measured: 1,
    skipped: [{ taskId: 'not-due', reason: 'not-due' }],
    outcomes: [{ taskId: 'action-1', projectId: 'growth-project', status: 'improved' }],
  })
})

describe('GET /api/cron/loop-review', () => {
  it('requires cron authorization', async () => {
    const { GET } = await import('@/app/api/cron/loop-review/route')

    const res = await GET(new NextRequest('http://localhost/api/cron/loop-review?orgId=pib-platform-owner'))

    expect(res.status).toBe(401)
    expect(mockCollectLoopReviewSignals).not.toHaveBeenCalled()
  })

  it('collects live signals and persists review tasks when requested', async () => {
    const { GET } = await import('@/app/api/cron/loop-review/route')

    const res = await GET(new NextRequest('http://localhost/api/cron/loop-review?orgId=pib-platform-owner&projectId=growth-project&persist=true&limit=10', {
      headers: { 'x-vercel-cron': '1' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockCollectLoopReviewSignals).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      limit: 10,
    }))
    expect(body.data).toMatchObject({
      scanned: 1,
      draftCount: 1,
      persisted: true,
    })
    expect(body.data.reviewTaskPersistence.created).toHaveLength(1)
    expect(mockTaskDoc).toHaveBeenCalledWith(body.data.reviewTaskPersistence.created[0].taskId)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'review',
      reviewStatus: 'pending',
      metadata: expect.objectContaining({
        businessInsightReview: expect.objectContaining({ type: 'business-insight-review' }),
      }),
    }), { merge: true })
    expect(mockRunSet).toHaveBeenCalledWith(expect.objectContaining({
      loopId: 'business-insight-review',
      status: 'executed',
      usage: expect.objectContaining({
        durationMs: expect.any(Number),
        retryCount: 0,
        toolCallCount: 0,
      }),
      runtime: expect.objectContaining({
        source: 'loop-review-cron',
        mode: 'collect',
        scanned: 1,
        agentSignalCount: 0,
        businessSignalCount: 1,
        reviewDraftCount: 1,
        persistedReviewTaskCount: 1,
      }),
    }), { merge: true })
  })

  it('can run outcome measurement without collecting new review signals', async () => {
    const { GET } = await import('@/app/api/cron/loop-review/route')

    const res = await GET(new NextRequest('http://localhost/api/cron/loop-review?orgId=pib-platform-owner&projectId=growth-project&mode=measure&limit=10', {
      headers: { 'x-vercel-cron': '1' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockCollectLoopReviewSignals).not.toHaveBeenCalled()
    expect(mockMeasureBusinessInsightOutcomes).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      limit: 10,
    }))
    expect(body.data).toMatchObject({
      mode: 'measure',
      outcomeMeasurement: {
        scanned: 2,
        measured: 1,
      },
    })
  })
})
