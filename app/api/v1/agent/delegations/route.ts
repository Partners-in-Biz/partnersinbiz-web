import { NextRequest } from 'next/server'

import { resolveUser } from '@/lib/api/auth'
import { mintAgentDelegation } from '@/lib/api/delegations'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isHumanInteractiveUser(user: ApiUser | null): user is ApiUser & { authKind: 'session' | 'firebase' } {
  if (!user) return false
  return user.role !== 'ai' && (user.authKind === 'session' || user.authKind === 'firebase')
}

export const POST = async (req: NextRequest) => {
  let user: ApiUser | null = null
  try {
    user = await resolveUser(req)
  } catch {
    return apiError('Unauthorized', 401)
  }

  if (!isHumanInteractiveUser(user)) {
    return apiError('Interactive human auth is required to mint agent delegations', 403)
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const orgId = normalizeText((body as Record<string, unknown>).orgId)
  const agentId = normalizeText((body as Record<string, unknown>).agentId)
  const purpose = normalizeText((body as Record<string, unknown>).purpose)
  const ttlSeconds = typeof (body as Record<string, unknown>).ttlSeconds === 'number'
    ? (body as Record<string, unknown>).ttlSeconds as number
    : undefined
  const conversationId = normalizeText((body as Record<string, unknown>).conversationId)

  if (!orgId) return apiError('orgId is required', 400)
  if (!agentId) return apiError('agentId is required', 400)
  if (!purpose) return apiError('purpose is required', 400)

  try {
    const delegation = await mintAgentDelegation({ user, orgId, agentId, purpose, ttlSeconds, conversationId })
    return apiSuccess(delegation, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
}
