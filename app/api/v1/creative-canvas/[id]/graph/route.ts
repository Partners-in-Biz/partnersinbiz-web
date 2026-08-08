import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { CreativeCanvasVersionConflictError, updateCreativeCanvasGraph } from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'
import { buildStudioStamp, type StudioAuditStamp } from '@/lib/design-audit/studio'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return {
    uid: user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)
  const expectedActiveVersion = typeof body.expectedActiveVersion === 'number'
    ? body.expectedActiveVersion
    : undefined
  const mergeOnConflict = body.mergeOnConflict === true
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 80)
    : undefined

  try {
    // Studio artifact gate: stamp design-audit findings onto HTML-bearing
    // nodes before saving, so the agent sees them in the artifact (light pass,
    // advisory — never blocks an iterative save). Findings surface in the
    // response and in node.data.designAudit for the finish gate.
    const designAudit: Record<string, StudioAuditStamp> = {}
    const bodyRecord = (body ?? {}) as Record<string, unknown>
    const nodes = Array.isArray(bodyRecord.nodes) ? bodyRecord.nodes : undefined
    if (Array.isArray(nodes)) {
      for (const node of nodes as Array<Record<string, unknown>>) {
        if (!node || typeof node !== 'object') continue
        const nodeId = typeof node.id === 'string' ? node.id : ''
        if (!nodeId) continue
        const data = (node.data ?? {}) as Record<string, unknown>
        const { stamp } = buildStudioStamp(nodeId, data)
        if (stamp) {
          designAudit[nodeId] = stamp
          node.data = { ...data, designAudit: stamp }
        } else if (data && typeof data === 'object' && 'designAudit' in data) {
          // Clean now: clear any stale stamp so the artifact shows the fix.
          const rest: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(data)) {
            if (k !== 'designAudit') rest[k] = v
          }
          node.data = rest
        }
      }
    }

    const canvas = await updateCreativeCanvasGraph(id, orgId, body, actorFromUser(user), {
      expectedActiveVersion,
      mergeOnConflict,
      baseGraphInput: body.baseGraph,
      reason,
    })
    return apiSuccess({ canvas, designAudit })
  } catch (error) {
    if (error instanceof CreativeCanvasVersionConflictError) {
      return apiError(error.message, 409, {
        code: 'creative_canvas_version_conflict',
        currentActiveVersion: error.currentActiveVersion,
        expectedActiveVersion: error.expectedActiveVersion,
        conflicts: error.conflicts,
        conflictDetails: error.conflictDetails,
      })
    }
    throw error
  }
})
