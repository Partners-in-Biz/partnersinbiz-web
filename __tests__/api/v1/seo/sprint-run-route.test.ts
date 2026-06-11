import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/seo/sprints/[id]/run/route'
import { runExecutionLoopForSprint } from '@/lib/seo/loops/execution'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/seo/loops/execution', () => ({
  runExecutionLoopForSprint: jest.fn(),
}))

process.env.AI_API_KEY = 'test-key'

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/v1/seo/sprints/sprint-1/run', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-key',
      ...headers,
    },
  })
}

describe('POST /api/v1/seo/sprints/[id]/run', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(runExecutionLoopForSprint as jest.Mock).mockResolvedValue({ done: [], queued: [], blocked: [] })
  })

  it('returns JSON for API callers', async () => {
    const res = await POST(makeReq({ accept: 'application/json' }), {
      params: Promise.resolve({ id: 'sprint-1' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({
      success: true,
      data: { done: [], queued: [], blocked: [] },
    })
  })

  it('redirects browser form submissions back to the sprint page instead of showing raw JSON', async () => {
    const res = await POST(makeReq({
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer: 'http://localhost/portal/seo/sprints/sprint-1/tasks',
    }), {
      params: Promise.resolve({ id: 'sprint-1' }),
    })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('http://localhost/portal/seo/sprints/sprint-1/tasks?seoRun=done')
  })
})
