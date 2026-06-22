import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  forkCreativeCanvasVersion,
  listCreativeCanvasVersions,
  restoreCreativeCanvasVersion,
} from '@/lib/creative-canvas/collaboration'
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

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const versions = await listCreativeCanvasVersions(id, orgId)
  return apiSuccess({ versions })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const body = await req.json().catch(() => null) as { action?: unknown; versionId?: unknown; title?: unknown } | null
  if (!body || typeof body.versionId !== 'string') return apiError('versionId is required', 400)

  try {
    if (body.action === 'restore') {
      const result = await restoreCreativeCanvasVersion(id, orgId, body.versionId, actorFromUser(user))
      return apiSuccess(result)
    }
    if (body.action === 'fork') {
      const result = await forkCreativeCanvasVersion(id, orgId, body.versionId, { title: body.title }, actorFromUser(user))
      return apiSuccess(result, 201)
    }
    return apiError('action must be restore or fork', 400)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Creative canvas version action failed', 400)
  }
})
