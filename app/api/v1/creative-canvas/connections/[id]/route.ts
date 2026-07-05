import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { revokeCreativeProviderConnection } from '@/lib/creative-canvas/connections/store'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export const DELETE = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0]
  if (!orgId) return apiError('orgId is required', 400)
  try {
    const connection = await revokeCreativeProviderConnection(
      decodeURIComponent(id),
      { orgId, uid: user.uid },
      { uid: user.uid, type: user.role === 'ai' ? 'agent' : 'user' },
    )
    return apiSuccess({ connection })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to revoke'
    return apiError(message, message === 'Forbidden' ? 403 : message === 'Connection not found' ? 404 : 500)
  }
})
