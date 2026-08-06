import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { disconnectChannelAccount } from '@/lib/communications/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * PATCH /api/v1/communications/channels/[id]
 * Disconnect an org channel account: status → not_connected, webhook route
 * removed. Encrypted credentials are retained so reconnect is a single step.
 */
export const PATCH = withAuth('client', async (req: NextRequest, user: ApiUser, context: RouteContext) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (body.action !== 'disconnect') return apiError('Unsupported action', 400)
  const { id } = await context.params
  const account = await disconnectChannelAccount(scope.orgId, id)
  if (!account) return apiError('Channel account not found', 404)
  return apiSuccess({ id, status: account.status, credentialRef: account.credentialRef })
})
