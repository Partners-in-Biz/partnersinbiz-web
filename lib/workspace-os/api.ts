import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError } from '@/lib/api/response'

export function resolveOrgId(req: NextRequest, user: ApiUser, body?: Record<string, unknown>): { orgId: string | null; mismatch: boolean } {
  const { searchParams } = new URL(req.url)
  const values = [
    typeof body?.orgId === 'string' ? body.orgId.trim() : '',
    searchParams.get('orgId')?.trim() ?? '',
    req.headers.get('x-org-id')?.trim() ?? '',
  ].filter(Boolean)
  const unique = [...new Set(values)]
  if (unique.length > 1) return { orgId: null, mismatch: true }
  if (user.role === 'client') return { orgId: user.orgId ?? user.orgIds?.[0] ?? unique[0] ?? null, mismatch: false }
  return { orgId: unique[0] ?? null, mismatch: false }
}

export function actorRole(user: ApiUser): 'ai' | 'admin' | 'client' {
  return user.role === 'ai' ? 'ai' : user.role === 'client' ? 'client' : 'admin'
}

export function orgAccessError(user: ApiUser, orgId: string | null, mismatch = false): Response | null {
  if (mismatch) return apiError('orgId mismatch', 400)
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  return null
}
