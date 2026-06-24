/**
 * POST /api/v1/admin/hermes/profiles/[orgId]/restart
 *
 * Requests a restart of the linked Hermes agent process. The Hermes admin
 * sidecar exposes a restart hook at `/api/restart`; we POST to it through the
 * authenticated dashboard proxy. After issuing the restart we probe `/v1/health`
 * so the operator immediately sees whether the agent came back up.
 *
 * If the sidecar does not implement a restart hook (404/501) the response says
 * so plainly rather than pretending success.
 *
 * Super-admin only. Audited.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { callHermesJson, requireHermesProfileAccess } from '@/lib/hermes/server'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ orgId: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can restart a Hermes agent', 403)
  const { orgId } = await (ctx as RouteContext).params

  const access = await requireHermesProfileAccess(user, orgId, 'dashboard')
  if (access instanceof Response) return access
  const link = access.link

  // Issue the restart against the agent gateway.
  let restartIssued = false
  let restartStatus: number | null = null
  let restartDetail = ''
  try {
    const { response, data } = await callHermesJson(link, '/api/restart', { method: 'POST', body: JSON.stringify({}) })
    restartStatus = response.status
    restartIssued = response.ok
    restartDetail = response.ok
      ? 'Restart accepted'
      : response.status === 404 || response.status === 501
        ? 'Agent gateway does not expose a restart hook'
        : `Agent gateway returned ${response.status}`
    if (data && typeof data === 'object' && 'raw' in (data as Record<string, unknown>)) {
      // keep raw detail short
    }
  } catch (err) {
    restartDetail = err instanceof Error ? `Could not reach agent: ${err.message}` : 'Could not reach agent gateway'
  }

  // Probe health so the response reflects current liveness regardless.
  let health: 'ok' | 'degraded' | 'unreachable' = 'unreachable'
  try {
    const { response } = await callHermesJson(link, '/v1/health', { method: 'GET' })
    health = response.ok ? 'ok' : 'degraded'
  } catch {
    health = 'unreachable'
  }

  await writeAdminAudit(user, {
    action: 'hermes.restart',
    orgId,
    summary: `Requested restart of Hermes profile ${link.profile} (org ${orgId}) — ${restartIssued ? 'accepted' : 'not accepted'}`,
    metadata: { orgId, profile: link.profile, restartIssued, restartStatus, health },
  })

  return apiSuccess({
    orgId,
    profile: link.profile,
    restartIssued,
    restartStatus,
    detail: restartDetail,
    health,
  })
})
