import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  createCreativeCanvas,
  createCreativeCanvasAtId,
  getCreativeCanvas,
  listCreativeCanvases,
} from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'
import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import { claimStudioArtifactOrigin, completeStudioArtifactOrigin, releaseStudioArtifactOrigin, StudioArtifactOriginError, validateStudioArtifactOrigin } from '@/lib/chat-context/originStore'
import {
  clientVisibilityFieldsForWrite,
  resolveWorkScopeFromRequest,
  resolveWorkScopeFromSearchParams,
  workScopeFieldsForWrite,
} from '@/lib/work-scope'

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
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  const canvases = await listCreativeCanvases(orgId, resolveWorkScopeFromSearchParams(new URL(req.url).searchParams, user.uid))
  return apiSuccess({ canvases })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)
  const raw = body as Record<string, unknown>
  const scopeFields = {
    ...workScopeFieldsForWrite(resolveWorkScopeFromRequest({ searchParams: new URL(req.url).searchParams, body: raw, uid: user.uid })),
    ...clientVisibilityFieldsForWrite(raw.clientVisibility),
  }
  let origin
  let reservedArtifactId: string | undefined
  let claimNonce: string | undefined
  if (raw.conversationOrigin !== undefined) {
    try {
      const candidate = raw.conversationOrigin as { conversationId?: unknown }
      const conversationId = typeof candidate?.conversationId === 'string' ? candidate.conversationId : ''
      origin = await validateStudioArtifactOrigin({
        value: raw.conversationOrigin,
        orgId,
        targetDomain: 'marketing_studio',
        conversation: conversationId ? await getConversation(conversationId) : null,
        user,
        loadMessage: async (id) => {
          const snap = await messagesCollection(conversationId).doc(id).get()
          return snap.exists ? snap.data() ?? null : null
        },
      })
      const claim = await claimStudioArtifactOrigin('marketing_studio', orgId, origin)
      if (!claim.claimed) {
        if (!claim.artifactId) return apiError('Artifact creation is already in progress', 409)
        const existing = await getCreativeCanvas(claim.artifactId, orgId)
        if (!existing) return apiError('Origin artifact is unavailable', 409)
        await completeStudioArtifactOrigin('marketing_studio', orgId, origin, existing.id, claim.claimNonce)
        return apiSuccess({ canvas: existing, idempotent: true })
      }
      reservedArtifactId = claim.artifactId
      claimNonce = claim.claimNonce
    } catch (error) {
      if (error instanceof StudioArtifactOriginError) return apiError(error.message, error.status)
      throw error
    }
  }
  let canvas
  try {
    canvas = origin && reservedArtifactId
      ? await createCreativeCanvasAtId(body, orgId, actorFromUser(user), reservedArtifactId, scopeFields)
      : await createCreativeCanvas(body, orgId, actorFromUser(user), scopeFields)
  } catch (error) {
    if (origin) await releaseStudioArtifactOrigin('marketing_studio', orgId, origin, claimNonce)
    throw error
  }
  if (origin) await completeStudioArtifactOrigin('marketing_studio', orgId, origin, canvas.id, claimNonce)
  return apiSuccess({ canvas }, 201)
})
