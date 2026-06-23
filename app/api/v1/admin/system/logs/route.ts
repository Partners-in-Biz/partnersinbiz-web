/**
 * GET /api/v1/admin/system/logs
 *
 * Lists error events from the `error_events` collection (US-267) with filters:
 *   ?severity=info|warning|error|critical
 *   ?orgId=<orgId>
 *   ?resolved=true|false
 *   ?from=<ISO|ms>&to=<ISO|ms>
 *   ?limit=<n>  (default 100, max 500)
 *
 * To avoid composite indexes we read a single ordered slice (createdAt desc),
 * then apply severity / org / resolved / date filters in memory. Returns a real
 * empty state when there are no records yet.
 *
 * Auth: admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { ERROR_EVENTS_COLLECTION, ERROR_SEVERITIES, type ErrorSeverity } from '@/lib/observability/error-log'

export const dynamic = 'force-dynamic'

type RawEvent = {
  message?: string
  stack?: string | null
  severity?: string
  orgId?: string | null
  source?: string
  route?: string | null
  resolvedAt?: { toMillis?: () => number } | null
  assignedTo?: string | null
  createdAt?: { toMillis?: () => number } | null
}

function toMs(v: { toMillis?: () => number } | null | undefined): number | null {
  if (v && typeof v.toMillis === 'function') return v.toMillis()
  return null
}

function parseDate(value: string | null): number | null {
  if (!value) return null
  if (/^\d+$/.test(value)) return Number(value)
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

export const GET = withAuth('admin', async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const severity = searchParams.get('severity') as ErrorSeverity | null
  const orgId = searchParams.get('orgId')
  const resolvedParam = searchParams.get('resolved')
  const fromMs = parseDate(searchParams.get('from'))
  const toMsParam = parseDate(searchParams.get('to'))
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 100))

  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || null
  // Derive a host-only Sentry org URL from the DSN so the UI can deep-link
  // without leaking the secret public key. DSN form: https://<key>@<host>/<projectId>
  let sentryUrl: string | null = null
  if (sentryDsn) {
    const m = sentryDsn.match(/@([^/]+)\/(\d+)/)
    if (m) {
      const host = m[1].replace(/\.ingest\./, '.')
      sentryUrl = `https://${host}/issues/`
    }
  }

  // Single ordered read — newest first. Read a generous slice (limit*3 capped)
  // then filter in memory so no composite index is required.
  const readCount = Math.min(1500, limit * 3)
  const snap = await adminDb
    .collection(ERROR_EVENTS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(readCount)
    .get()

  let events = snap.docs.map((d) => {
    const data = d.data() as RawEvent
    return {
      id: d.id,
      message: data.message ?? '',
      stack: data.stack ?? null,
      severity: (ERROR_SEVERITIES.includes(data.severity as ErrorSeverity)
        ? data.severity
        : 'error') as ErrorSeverity,
      orgId: data.orgId ?? null,
      source: data.source ?? 'app',
      route: data.route ?? null,
      resolvedAt: toMs(data.resolvedAt),
      assignedTo: data.assignedTo ?? null,
      createdAt: toMs(data.createdAt),
    }
  })

  if (severity && ERROR_SEVERITIES.includes(severity)) {
    events = events.filter((e) => e.severity === severity)
  }
  if (orgId) {
    events = events.filter((e) => e.orgId === orgId)
  }
  if (resolvedParam === 'true') {
    events = events.filter((e) => e.resolvedAt !== null)
  } else if (resolvedParam === 'false') {
    events = events.filter((e) => e.resolvedAt === null)
  }
  if (fromMs !== null) {
    events = events.filter((e) => e.createdAt !== null && e.createdAt >= fromMs)
  }
  if (toMsParam !== null) {
    events = events.filter((e) => e.createdAt !== null && e.createdAt <= toMsParam)
  }

  const sliced = events.slice(0, limit)

  return apiSuccess({
    events: sliced,
    total: sliced.length,
    truncated: events.length > limit,
    sentryConfigured: Boolean(sentryDsn),
    sentryUrl,
    empty: snap.empty,
  })
})
