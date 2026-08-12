// __tests__/api/v1/properties/[id]/connections/[provider]/backfill/route.test.ts
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/integrations/bootstrap', () => ({}))

jest.mock('@/lib/integrations/connections', () => ({
  getConnection: jest.fn(),
  markPullSuccess: jest.fn(),
  markPullFailure: jest.fn(),
}))

jest.mock('@/lib/integrations/registry', () => ({
  getAdapter: jest.fn(),
}))

import { adminDb } from '@/lib/firebase/admin'
import { POST } from '@/app/api/v1/properties/[id]/connections/[provider]/backfill/route'
import { getConnection, markPullSuccess, markPullFailure } from '@/lib/integrations/connections'
import { getAdapter } from '@/lib/integrations/registry'

process.env.AI_API_KEY = 'test-key'

const CTX = (id = 'prop-123', provider = 'ga4') => ({
  params: Promise.resolve({ id, provider }),
})

function makeReq(auth?: string) {
  return new NextRequest('http://localhost/api/v1/properties/prop-123/connections/ga4/backfill', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })
}

const connection = {
  id: 'ga4',
  provider: 'ga4',
  propertyId: 'prop-123',
  orgId: 'org-lumen',
  authKind: 'oauth2',
  status: 'connected',
  credentialsEnc: { ciphertext: 'x', iv: 'y', tag: 'z' },
  meta: {},
  scope: [],
  lastPulledAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  backfilledThrough: null,
  createdAt: null,
  updatedAt: null,
  createdBy: 'system',
  createdByType: 'system' as const,
}

describe('POST /api/v1/properties/:id/connections/:provider/backfill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          id: 'prop-123',
          data: () => ({ orgId: 'org-lumen', deleted: false }),
        }),
      }),
    })
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await POST(makeReq(), CTX())
    expect(res.status).toBe(401)
    expect(getConnection).not.toHaveBeenCalled()
  })

  it('returns 401 with a bad bearer token', async () => {
    const res = await POST(makeReq('Bearer wrong-key'), CTX())
    expect(res.status).toBe(401)
    expect(getConnection).not.toHaveBeenCalled()
  })

  it('returns 400 for an unknown provider', async () => {
    const res = await POST(makeReq('Bearer test-key'), CTX('prop-123', 'not-a-provider'))
    expect(res.status).toBe(400)
    expect(getConnection).not.toHaveBeenCalled()
  })

  it('returns 404 when the property has no connection for this provider', async () => {
    ;(getConnection as jest.Mock).mockResolvedValue(null)
    const res = await POST(makeReq('Bearer test-key'), CTX())
    expect(res.status).toBe(404)
  })

  it('returns 501 when no adapter is registered for the provider', async () => {
    ;(getConnection as jest.Mock).mockResolvedValue(connection)
    ;(getAdapter as jest.Mock).mockReturnValue(null)
    const res = await POST(makeReq('Bearer test-key'), CTX())
    expect(res.status).toBe(501)
  })

  it('calls adapter.pullDaily exactly once with a 90-day window and upserts idempotently', async () => {
    ;(getConnection as jest.Mock).mockResolvedValue(connection)
    const pullDaily = jest.fn().mockResolvedValue({
      from: '2026-04-03',
      to: '2026-07-01',
      metricsWritten: 90 * 8, // e.g. 8 metric kinds per day, upserted via deterministic doc ids
      notes: [],
    })
    ;(getAdapter as jest.Mock).mockReturnValue({
      provider: 'ga4',
      authKind: 'oauth2',
      display: { name: 'GA4', description: '' },
      pullDaily,
    })

    const res = await POST(makeReq('Bearer test-key'), CTX())
    expect(res.status).toBe(200)
    const body = await res.json()

    // Reuses the EXISTING adapter.pullDaily — called exactly once (range
    // pull, not per-day looping) since GA4's runReport natively accepts a
    // date range and returns one row per date.
    expect(pullDaily).toHaveBeenCalledTimes(1)
    const call = pullDaily.mock.calls[0][0]
    expect(call.connection).toEqual(connection)
    expect(call.window).toBeDefined()
    expect(call.window.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(call.window.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Window spans exactly 90 days inclusive (to - from == 89 days).
    const from = new Date(`${call.window.from}T00:00:00Z`)
    const to = new Date(`${call.window.to}T00:00:00Z`)
    const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
    expect(diffDays).toBe(89)

    expect(body.ok).toBe(true)
    expect(body.days).toBe(90)
    expect(body.metricsWritten).toBe(90 * 8)

    // Idempotency bookkeeping: marks success with the backfilled-through date
    // (same connections.ts helper the daily dispatcher/pull route already use).
    expect(markPullSuccess).toHaveBeenCalledTimes(1)
    expect(markPullSuccess).toHaveBeenCalledWith({
      propertyId: 'prop-123',
      provider: 'ga4',
      backfilledThrough: '2026-07-01',
    })
    expect(markPullFailure).not.toHaveBeenCalled()
  })

  it('marks failure and returns 502 when the adapter throws', async () => {
    ;(getConnection as jest.Mock).mockResolvedValue(connection)
    const pullDaily = jest.fn().mockRejectedValue(new Error('GA4 5xx'))
    ;(getAdapter as jest.Mock).mockReturnValue({
      provider: 'ga4',
      authKind: 'oauth2',
      display: { name: 'GA4', description: '' },
      pullDaily,
    })

    const res = await POST(makeReq('Bearer test-key'), CTX())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(markPullFailure).toHaveBeenCalledTimes(1)
    expect(markPullFailure).toHaveBeenCalledWith({
      propertyId: 'prop-123',
      provider: 'ga4',
      error: 'GA4 5xx',
    })
    expect(markPullSuccess).not.toHaveBeenCalled()
  })
})
