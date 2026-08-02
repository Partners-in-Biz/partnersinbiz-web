import { NextRequest } from 'next/server'

const mockRefreshDueXaiLlmConnections = jest.fn()
const mockRunWithFirestoreReadAudit = jest.fn((_label: string, fn: () => unknown) => fn())

jest.mock('@/lib/llm-providers/refresh-worker', () => ({
  refreshDueXaiLlmConnections: (...args: unknown[]) => mockRefreshDueXaiLlmConnections(...args),
}))

jest.mock('@/lib/firebase/read-audit', () => ({
  runWithFirestoreReadAudit: (...args: unknown[]) => mockRunWithFirestoreReadAudit(...args),
}))

describe('LLM credential refresh cron route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
  })

  it('rejects an unauthenticated request', async () => {
    const { GET } = await import('@/app/api/cron/llm-credential-refresh/route')

    const response = await GET(new NextRequest('http://localhost/api/cron/llm-credential-refresh'))

    expect(response.status).toBe(401)
    expect(mockRefreshDueXaiLlmConnections).not.toHaveBeenCalled()
  })

  it('runs the refresh worker for an authorized Vercel cron invocation', async () => {
    mockRefreshDueXaiLlmConnections.mockResolvedValue({
      scanned: 3,
      due: 1,
      refreshed: 1,
      synced: 12,
      queued: 0,
      failed: 0,
    })
    const { GET } = await import('@/app/api/cron/llm-credential-refresh/route')

    const response = await GET(new NextRequest('http://localhost/api/cron/llm-credential-refresh', {
      headers: { 'x-vercel-cron': '1' },
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockRunWithFirestoreReadAudit).toHaveBeenCalledWith('api/cron/llm-credential-refresh', expect.any(Function))
    expect(mockRefreshDueXaiLlmConnections).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ success: true, data: { due: 1, synced: 12, failed: 0 } })
  })
})
