import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { setCreativeCanvasShareEnabled } from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return { uid: user.uid, type: user.role === 'ai' ? 'agent' : 'user' }
}

/** Enable/disable the public read-only share link for a canvas. */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  const body = await req.json().catch(() => null) as { enabled?: unknown } | null
  if (!body || typeof body.enabled !== 'boolean') return apiError('enabled boolean is required', 400)

  try {
    const canvas = await setCreativeCanvasShareEnabled(id, orgId, body.enabled, actorFromUser(user))
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
    return apiSuccess({
      shareEnabled: canvas.shareEnabled === true,
      shareToken: canvas.shareToken,
      shareUrl: canvas.shareEnabled && canvas.shareToken ? `${baseUrl}/c/canvas/${canvas.shareToken}` : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Share update failed'
    return apiError(message, message.includes('not found') ? 404 : 500)
  }
})
