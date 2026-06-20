import { NextRequest } from 'next/server'

const mockDrainHiggsfieldCreativeCanvasRuns = jest.fn()
const mockRunWithFirestoreReadAudit = jest.fn((_label: string, fn: () => unknown) => fn())

jest.mock('@/lib/creative-canvas/provider-runtime', () => ({
  drainHiggsfieldCreativeCanvasRuns: (...args: unknown[]) => mockDrainHiggsfieldCreativeCanvasRuns(...args),
}))

jest.mock('@/lib/firebase/read-audit', () => ({
  runWithFirestoreReadAudit: (...args: unknown[]) => mockRunWithFirestoreReadAudit(...args),
}))

describe('creative canvas provider runtime cron route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
  })

  it('rejects unauthenticated requests', async () => {
    const { GET } = await import('@/app/api/cron/creative-canvas-provider-runs/route')

    const res = await GET(new NextRequest('http://localhost/api/cron/creative-canvas-provider-runs'))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ success: false, error: 'Unauthorized' })
    expect(mockDrainHiggsfieldCreativeCanvasRuns).not.toHaveBeenCalled()
  })

  it('drains Higgsfield provider runs for authorized cron requests', async () => {
    const { POST } = await import('@/app/api/cron/creative-canvas-provider-runs/route')
    mockDrainHiggsfieldCreativeCanvasRuns.mockResolvedValue({
      submitted: 1,
      polled: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      runtimeConfigured: true,
    })

    const res = await POST(new NextRequest('http://localhost/api/cron/creative-canvas-provider-runs?submitLimit=2&pollLimit=3', {
      method: 'POST',
      headers: { Authorization: 'Bearer cron-secret' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockRunWithFirestoreReadAudit).toHaveBeenCalledWith('api/cron/creative-canvas-provider-runs', expect.any(Function))
    expect(mockDrainHiggsfieldCreativeCanvasRuns).toHaveBeenCalledWith({ submitLimit: 2, pollLimit: 3 })
    expect(body).toMatchObject({
      success: true,
      data: {
        submitted: 1,
        completed: 1,
        runtimeConfigured: true,
      },
    })
  })
})
