import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { CreativeCanvasVersionConflictError, updateCreativeCanvasGraph } from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

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
    const canvas = await updateCreativeCanvasGraph(id, orgId, body, actorFromUser(user), {
      expectedActiveVersion,
      mergeOnConflict,
      baseGraphInput: body.baseGraph,
      reason,
    })
    return apiSuccess({ canvas })
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
