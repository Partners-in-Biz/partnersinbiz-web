import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import type { PropertyConfig } from '@/lib/properties/types'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { id } = await ctx.params
  const ingestKey = req.headers.get('x-pib-ingest-key')
  // PUBLIC: property runtime config lookup protected by per-property ingest key.
  const ipLimited = await enforcePublicRateLimit(req, {
    key: `property_config:${id}:${publicRequestIp(req)}`,
    limit: 120,
    windowMs: 60 * 60 * 1000,
  })
  if (ipLimited) return ipLimited
  if (ingestKey) {
    const keyLimited = await enforcePublicRateLimit(req, {
      key: `property_config_key:${id}:${publicRateLimitHash(ingestKey)}`,
      limit: 240,
      windowMs: 60 * 60 * 1000,
    })
    if (keyLimited) return keyLimited
  }

  if (!ingestKey) {
    return NextResponse.json(
      { error: 'x-pib-ingest-key header required' },
      { status: 401 },
    )
  }

  try {
    const snap = await adminDb.collection('properties').doc(id).get()
    if (!snap.exists || snap.data()?.deleted) {
      return NextResponse.json({ error: 'Invalid ingest key' }, { status: 401 })
    }

    const data = snap.data()!
    if (data.ingestKey !== ingestKey) {
      return NextResponse.json({ error: 'Invalid ingest key' }, { status: 401 })
    }

    const config: PropertyConfig = data.config ?? {}

    if (config.killSwitch) {
      return NextResponse.json(
        { killSwitch: true, message: 'This site is temporarily unavailable.' },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        },
      )
    }

    return NextResponse.json(config, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    console.error('[properties-config-get-error]', err)
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 })
  }
}
