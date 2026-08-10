// POST /api/v1/properties/:id/connections/:provider/backfill
//
// Admin-triggered 90-day backfill for a single property's connected
// provider. Reuses the SAME adapter.pullDaily() used by the daily cron
// (lib/integrations/dispatch.ts) and the "Pull now" one-shot route
// (../pull/route.ts) — no pull logic is duplicated here.
//
// Idempotency: pullDaily() -> writeMetrics() upserts each metric row via a
// deterministic doc id hashed from (orgId, propertyId, date, source, metric,
// dimension, dimensionValue) and Firestore `.set()` (not `.add()`). Running
// this route multiple times for the same window overwrites the same rows
// instead of duplicating them — see lib/metrics/write.ts.
//
// Window: a single 90-day inclusive range is passed straight through to the
// adapter's `window: { from, to }` param (the same override the "Pull now"
// path already supports). GA4 / AdMob / RevenueCat's underlying provider
// calls (runReport / generateNetworkReport / getProjectMetrics) all accept a
// date range natively and return one row per date in range, so a single
// adapter call covers the whole 90-day window — no per-day looping needed.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { getConnection, markPullSuccess, markPullFailure } from '@/lib/integrations/connections'
import { getAdapter } from '@/lib/integrations/registry'
import '@/lib/integrations/bootstrap'
import { ALL_PROVIDERS, type IntegrationProvider, type PullResult } from '@/lib/integrations/types'
import { loadOwnerAuthorizedProperty } from '@/lib/properties/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type RouteContext = { params: Promise<{ id: string; provider: string }> }

const BACKFILL_DAYS = 90

function isProvider(v: string): v is IntegrationProvider {
  return (ALL_PROVIDERS as string[]).includes(v)
}

/** 'YYYY-MM-DD' for `daysAgo` days before `now`, in UTC. */
function isoDaysAgo(now: Date, daysAgo: number): string {
  const ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id, provider } = await (ctx as RouteContext).params
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const access = await loadOwnerAuthorizedProperty(user, id)
  if (!access.ok) return access.response
  const propertyId = access.property.id

  const conn = await getConnection({ propertyId, provider })
  if (!conn) return NextResponse.json({ error: 'Not connected' }, { status: 404 })

  const adapter = getAdapter(provider)
  if (!adapter) {
    return NextResponse.json({ error: 'Adapter not registered' }, { status: 501 })
  }

  const now = new Date()
  // Yesterday through 90 days back — matches the adapters' own "yesterday"
  // default window so we never double-request "today" (which is usually
  // incomplete at the provider).
  const to = isoDaysAgo(now, 1)
  const from = isoDaysAgo(now, BACKFILL_DAYS)

  let result: PullResult
  try {
    result = await adapter.pullDaily({ connection: conn, window: { from, to } })
    await markPullSuccess({
      propertyId,
      provider,
      backfilledThrough: result.to || to,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markPullFailure({ propertyId, provider, error: message })
    return NextResponse.json({ ok: false, error: message, from, to }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    provider,
    propertyId,
    from,
    to,
    days: BACKFILL_DAYS,
    metricsWritten: result.metricsWritten,
    notes: result.notes ?? [],
  })
})
