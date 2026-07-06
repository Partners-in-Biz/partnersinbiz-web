import { NextRequest } from 'next/server'

const mockDrainDueYouTubeReleasePlans = jest.fn()
const mockRunWithFirestoreReadAudit = jest.fn((_label: string, fn: () => unknown) => fn())

jest.mock('@/lib/youtube-studio/publish-executor', () => ({
  drainDueYouTubeReleasePlans: (...args: unknown[]) => mockDrainDueYouTubeReleasePlans(...args),
}))

jest.mock('@/lib/firebase/read-audit', () => ({
  runWithFirestoreReadAudit: (...args: unknown[]) => mockRunWithFirestoreReadAudit(...args),
}))

describe('youtube studio scheduled publish cron route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
  })

  it('rejects unauthenticated requests', async () => {
    const { GET } = await import('@/app/api/cron/youtube-studio-publish/route')

    const res = await GET(new NextRequest('http://localhost/api/cron/youtube-studio-publish'))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ success: false, error: 'Unauthorized' })
    expect(mockDrainDueYouTubeReleasePlans).not.toHaveBeenCalled()
  })

  it('accepts a request bearing the x-vercel-cron header', async () => {
    mockDrainDueYouTubeReleasePlans.mockResolvedValue({ due: 0, published: 0, blocked: 0, retried: 0, exhausted: 0, skipped: 0 })
    const { POST } = await import('@/app/api/cron/youtube-studio-publish/route')

    const res = await POST(new NextRequest('http://localhost/api/cron/youtube-studio-publish', {
      method: 'POST',
      headers: { 'x-vercel-cron': '1' },
    }))

    expect(res.status).toBe(200)
    expect(mockDrainDueYouTubeReleasePlans).toHaveBeenCalledTimes(1)
  })

  it('drains due release plans and passes the counts through for authorized requests', async () => {
    mockDrainDueYouTubeReleasePlans.mockResolvedValue({
      due: 3, published: 1, blocked: 1, retried: 1, exhausted: 0, skipped: 0,
    })
    const { POST } = await import('@/app/api/cron/youtube-studio-publish/route')

    const res = await POST(new NextRequest('http://localhost/api/cron/youtube-studio-publish?limit=5', {
      method: 'POST',
      headers: { Authorization: 'Bearer cron-secret' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockRunWithFirestoreReadAudit).toHaveBeenCalledWith('api/cron/youtube-studio-publish', expect.any(Function))
    expect(mockDrainDueYouTubeReleasePlans).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }))
    expect(body).toMatchObject({
      success: true,
      data: { due: 3, published: 1, blocked: 1, retried: 1, exhausted: 0, skipped: 0 },
    })
  })
})
