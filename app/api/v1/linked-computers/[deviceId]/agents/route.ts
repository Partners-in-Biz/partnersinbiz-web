import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { listCatalogAgentIds, listDeviceDesiredAgents, setDeviceDesiredAgents } from '@/lib/linked-computers/agent-host-service'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string }> }

function hostError(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Linked computer agent request failed'
  const status = /not found/.test(message) ? 404
    : /required|administrator|owner|membership|denied|not owned/.test(message) ? 403
      : /idempotency|queue full/.test(message) ? 409
        : 400
  return apiError(
    status === 403 ? 'You cannot manage agents on this computer.'
      : status === 404 ? 'Computer not found.'
        : status === 409 ? 'Agent sync queue conflict. Retry shortly.'
          : message,
    status,
  )
}

export const GET = withAuth('client', async (req: NextRequest, user, context) => {
  const { deviceId } = await (context as Context).params
  const orgIdParam = new URL(req.url).searchParams.get('orgId')
  const scope = resolveOrgScope(user, orgIdParam)
  if (!scope.ok) return apiError(scope.error, scope.status)
  try {
    const [inventory, catalogAgentIds] = await Promise.all([
      listDeviceDesiredAgents(deviceId),
      listCatalogAgentIds(),
    ])
    return apiSuccess({
      ...inventory,
      catalogAgentIds,
      orgId: scope.orgId,
    })
  } catch (error) {
    return hostError(error)
  }
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { deviceId } = await (context as Context).params
  let body: Record<string, unknown> = {}
  try { body = await req.json() as Record<string, unknown> } catch { body = {} }
  const orgIdParam = typeof body.orgId === 'string' ? body.orgId : new URL(req.url).searchParams.get('orgId')
  const scope = resolveOrgScope(user, orgIdParam)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const desiredRaw = Array.isArray(body.desiredAgents) ? body.desiredAgents : []
  const desired = desiredRaw.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return []
    const record = row as Record<string, unknown>
    if (typeof record.agentId !== 'string') return []
    return [{ agentId: record.agentId, keepInSync: record.keepInSync === true }]
  })

  try {
    const result = await setDeviceDesiredAgents({
      deviceId,
      actorUserId: user.uid,
      orgId: scope.orgId,
      desired,
      enqueueJobs: body.enqueueJobs !== false,
    })
    const catalogAgentIds = await listCatalogAgentIds()
    return apiSuccess({
      deviceId,
      orgId: scope.orgId,
      desiredAgents: result.desiredAgents,
      enqueuedJobIds: result.enqueuedJobIds,
      catalogAgentIds,
    })
  } catch (error) {
    return hostError(error)
  }
})
