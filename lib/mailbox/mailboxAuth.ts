import { NextRequest } from 'next/server'

import { resolveUser } from '@/lib/api/auth'
import { remintExpiredMessagesDelegation, resolveDelegationTokenUser } from '@/lib/api/delegations'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getMaintenanceState, isMaintenanceActiveNow, requestBypassesMaintenance } from '@/lib/governance/maintenance'

type RouteHandler = (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>

function bearerToken(req: NextRequest): string {
  const header = req.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

/**
 * Resolve the caller for /agent/email/*.
 * Expired Messages pib_dlg_ tokens are reminted once via the system-auth mint path.
 * A dlg bearer never falls through to AI_API_KEY / pib_ag_.
 */
export async function resolveMailboxRequestUser(req: NextRequest): Promise<ApiUser | null> {
  const token = bearerToken(req)
  if (token.startsWith('pib_dlg_')) {
    const live = await resolveDelegationTokenUser(token)
    if (live) return live
    const reminted = await remintExpiredMessagesDelegation(token)
    if (!reminted?.token) return null
    return resolveDelegationTokenUser(reminted.token)
  }
  return resolveUser(req)
}

export function withMailboxAuth(requiredRole: 'admin' | 'client', handler: RouteHandler): (req: NextRequest, context?: unknown) => Promise<Response> {
  return async (req: NextRequest, context?: unknown): Promise<Response> => {
    let user: ApiUser | null
    try {
      user = await resolveMailboxRequestUser(req)
    } catch {
      return apiError('Unauthorized', 401)
    }
    if (!user) return apiError('Unauthorized', 401)

    const roleOk =
      user.role === 'ai' ||
      user.role === 'admin' ||
      (requiredRole === 'client' && user.role === 'client')
    if (!roleOk) return apiError('Forbidden', 403)

    if (requiredRole === 'client' && user.role === 'client') {
      const maintenance = await getMaintenanceState()
      if (isMaintenanceActiveNow(maintenance, Date.now()) && !requestBypassesMaintenance(req.headers, maintenance, user.role)) {
        return apiError(maintenance.message || 'Scheduled maintenance in progress', 503)
      }
    }

    if (user.role === 'admin' || user.role === 'client') {
      const url = new URL(req.url)
      const scopedOrgId = url.searchParams.get('orgId') ?? req.headers.get('x-org-id')
      if (scopedOrgId && !canAccessOrg(user, scopedOrgId)) {
        return apiError('Forbidden', 403)
      }
    }

    try {
      return await handler(req, user, context)
    } catch (err) {
      return apiErrorFromException(err)
    }
  }
}
