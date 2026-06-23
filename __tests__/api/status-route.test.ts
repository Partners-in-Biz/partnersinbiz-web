import { NextRequest } from 'next/server'

jest.mock('@/lib/observability/health-probe', () => ({
  probeAllServices: jest.fn(),
}))

import { probeAllServices } from '@/lib/observability/health-probe'

describe('GET /api/v1/status', () => {
  it('returns a safe public status snapshot without internal probe detail', async () => {
    ;(probeAllServices as jest.Mock).mockResolvedValue([
      {
        key: 'firestore',
        name: 'Firestore',
        status: 'ok',
        latencyMs: 42,
        latencyInstrumented: true,
        lastCheckedAt: '2026-06-23T10:00:00.000Z',
        detail: 'read round-trip',
      },
      {
        key: 'paypal',
        name: 'PayPal',
        status: 'not-configured',
        latencyMs: null,
        latencyInstrumented: true,
        lastCheckedAt: '2026-06-23T10:00:00.000Z',
        detail: 'PAYPAL_CLIENT_SECRET missing',
      },
    ])

    const { GET } = await import('@/app/api/v1/status/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/status'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({
      overall: 'ok',
      checkedAt: '2026-06-23T10:00:00.000Z',
      services: [
        {
          key: 'firestore',
          name: 'Firestore',
          status: 'ok',
          latencyMs: 42,
          latencyInstrumented: true,
        },
        {
          key: 'paypal',
          name: 'PayPal',
          status: 'not-configured',
          latencyMs: null,
          latencyInstrumented: true,
        },
      ],
    })
    expect(body.data.services[0]).not.toHaveProperty('detail')
  })
})
