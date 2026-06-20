import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  createCreativeCanvasTemplate,
  listCreativeCanvasTemplates,
} from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

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

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const templates = await listCreativeCanvasTemplates(orgId)
  return apiSuccess({ templates })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)
  const template = await createCreativeCanvasTemplate(body, orgId, actorFromUser(user))
  return apiSuccess({ template }, 201)
})
