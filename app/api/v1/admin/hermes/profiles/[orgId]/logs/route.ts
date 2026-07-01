/**
 * GET /api/v1/admin/hermes/profiles/[orgId]/logs
 *
 * Recent Hermes run activity for an org's linked profile, pulled from the
 * `hermes_runs` Firestore collection (the sidecars do not expose /api/logs, so
 * the run ledger is the authoritative log source). Query param ?limit=N
 * (default 40, max 150).
 *
 * Auth: admin (requires dashboard capability on the profile link).
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { HERMES_RUNS_COLLECTION, requireHermesProfileAccess } from '@/lib/hermes/server'
import { reconcileActiveHermesRunsForOrg } from '@/lib/hermes/run-ledger'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ orgId: string }> }

function tsToIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
    if (typeof v.toDate === 'function') { try { return v.toDate().toISOString() } catch { return null } }
    const seconds = v._seconds ?? v.seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  }
  if (typeof value === 'string') return value
  return null
}

export const GET = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as RouteContext).params
  const access = await requireHermesProfileAccess(user, orgId, 'dashboard')
  if (access instanceof Response) return access

  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? '40')
  const limit = Math.min(Math.max(1, Number.isFinite(limitParam) ? limitParam : 40), 150)
  let reconciliation: Awaited<ReturnType<typeof reconcileActiveHermesRunsForOrg>> | null = null

  try {
    reconciliation = await reconcileActiveHermesRunsForOrg(access.link, { limit: 12 })
  } catch (err) {
    console.warn('[hermes-logs-reconcile-failed]', err)
  }

  // Query by orgId only (no orderBy) to avoid composite-index requirements.
  const snap = await adminDb
    .collection(HERMES_RUNS_COLLECTION)
    .where('orgId', '==', orgId)
    .limit(Math.min(limit * 4, 600))
    .get()

  const runs = snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>
      return {
        id: d.id,
        profile: typeof data.profile === 'string' ? data.profile : null,
        hermesRunId: typeof data.hermesRunId === 'string' ? data.hermesRunId : null,
        requestedBy: typeof data.requestedBy === 'string' ? data.requestedBy : null,
        prompt: typeof data.prompt === 'string' ? data.prompt.slice(0, 240) : null,
        model: typeof data.model === 'string' ? data.model : null,
        status: typeof data.status === 'string' ? data.status : 'unknown',
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
      }
    })
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, limit)

  return apiSuccess({ orgId, runs, total: runs.length, reconciliation })
})
