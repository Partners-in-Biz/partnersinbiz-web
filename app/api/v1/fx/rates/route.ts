// GET /api/v1/fx/rates?date=YYYY-MM-DD
// Returns the cached FX-to-ZAR doc for a given date (today by default).
// PUBLIC: rates are not sensitive and clients may need them in portal.

import { NextRequest, NextResponse } from 'next/server'
import { getFxDoc } from '@/lib/fx/rates'
import { enforcePublicRateLimit, publicRequestIp } from '@/lib/api/public-rate-limit'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  const limited = await enforcePublicRateLimit(req, {
    key: `fx_rates:${date}:${publicRequestIp(req)}`,
    limit: 120,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) return limited

  try {
    const doc = await getFxDoc(date)
    return NextResponse.json({
      ok: true,
      date: doc.date,
      base: doc.base,
      source: doc.source,
      rates: doc.rates,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'fx error' },
      { status: 500 },
    )
  }
}
