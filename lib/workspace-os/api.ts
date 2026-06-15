import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError } from '@/lib/api/response'

export function resolveOrgId(
  req: NextRequest,
  user: ApiUser,
  body?: Record<string, unknown>,
): { orgId: string | null; mismatch: boolean; error?: string; status?: 400 | 403 } {
  const { searchParams } = new URL(req.url)
  const values = [
    typeof body?.orgId === 'string' ? body.orgId.trim() : '',
    searchParams.get('orgId')?.trim() ?? '',
    req.headers.get('x-org-id')?.trim() ?? '',
  ].filter(Boolean)
  const unique = [...new Set(values)]
  if (unique.length > 1) return { orgId: null, mismatch: true }

  const scope = resolveOrgScope(user, unique[0] ?? null)
  if (!scope.ok) {
    return { orgId: null, mismatch: false, error: scope.error, status: scope.status }
  }
  return { orgId: scope.orgId, mismatch: false }
}

export function actorRole(user: ApiUser): 'ai' | 'admin' | 'client' {
  return user.role === 'ai' ? 'ai' : user.role === 'client' ? 'client' : 'admin'
}

export function orgAccessError(
  _user: ApiUser,
  orgId: string | null,
  mismatch = false,
  resolved?: { error?: string; status?: 400 | 403 },
): Response | null {
  if (mismatch) return apiError('orgId mismatch', 400)
  if (resolved?.error) return apiError(resolved.error, resolved.status ?? 400)
  if (!orgId) return apiError('orgId is required', 400)
  return null
}
