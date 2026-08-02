// __tests__/api/v1/crm/cron/process-research-tasks.test.ts
// Cron auth + batch wiring for CRM research worker

jest.mock('@/lib/crm/facts/research-worker', () => ({
  runResearchTaskWorkerBatch: jest.fn(),
}))

jest.mock('@/lib/firebase/read-audit', () => ({
  runWithFirestoreReadAudit: jest.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/crm/cron/process-research-tasks/route'
import { runResearchTaskWorkerBatch } from '@/lib/crm/facts/research-worker'

const mockBatch = runResearchTaskWorkerBatch as jest.Mock

function makeReq(authHeader?: string, url = 'http://localhost/api/v1/crm/cron/process-research-tasks') {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers.authorization = authHeader
  return new NextRequest(url, { headers })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
  mockBatch.mockResolvedValue({
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    results: [],
  })
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('GET /api/v1/crm/cron/process-research-tasks', () => {
  it('returns 401 when authorization header is missing', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header is wrong', async () => {
    const res = await GET(makeReq('Bearer wrong-token'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeReq('Bearer anything'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET not configured/i)
  })

  it('returns 200 with zero counts when queue is empty', async () => {
    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.processed).toBe(0)
    expect(body.data.succeeded).toBe(0)
    expect(body.data.failed).toBe(0)
    expect(mockBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTasks: 25,
        timeBudgetMs: 55_000,
        leaseSeconds: 300,
      }),
    )
  })

  it('honours limit query and returns batch counters', async () => {
    mockBatch.mockResolvedValue({
      processed: 2,
      succeeded: 1,
      failed: 1,
      skipped: 3,
      errors: ['task-1: boom'],
      results: [],
    })
    const res = await GET(
      makeReq(
        'Bearer test-secret',
        'http://localhost/api/v1/crm/cron/process-research-tasks?limit=10',
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual(
      expect.objectContaining({
        processed: 2,
        succeeded: 1,
        failed: 1,
        skipped: 3,
        errors: ['task-1: boom'],
      }),
    )
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ maxTasks: 10 }))
  })
})
