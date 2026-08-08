import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  findDesignContextItem,
  upsertDesignContext,
} from '@/lib/research/store'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'

export const dynamic = 'force-dynamic'

/**
 * Design Context — per-client structured design system record.
 *
 * - GET  /api/v1/research/design-context?orgId=...&companyId=... → latest record
 * - POST /api/v1/research/design-context → upsert from questionnaire answers
 *   (gather path (a), /impeccable init equivalent)
 *
 * Store lives in research_items with kind='design'; every save bumps version
 * and appends prior payloads to history. Tenant-safe via resolveOrgScope.
 */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const scope = resolveOrgScope(user, req.nextUrl.searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)

  const companyId = req.nextUrl.searchParams.get('companyId')?.trim() || null
  const item = await findDesignContextItem(scope.orgId, companyId)
  if (!item) return apiSuccess({ found: false, designContext: null })
  return apiSuccess({ found: true, designContext: item.designContext ?? null, item: { id: item.id, title: item.title, updatedAt: item.updatedAt } })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const createAccess = await assertUserCanPerformOrganizationModuleAction(
    user,
    scope.orgId,
    'research',
    'create',
    'Design context creation is disabled for your organisation role',
  )
  if (!createAccess.ok) return apiError(createAccess.error, createAccess.status)

  const payload = {
    audience: body.audience,
    positioning: body.positioning,
    brandVoice: body.brandVoice,
    antiReferences: body.antiReferences,
    palette: body.palette,
    typeStack: body.typeStack,
    componentRules: body.componentRules,
    radiusScale: body.radiusScale,
    elevationScale: body.elevationScale,
    surfaceModes: body.surfaceModes,
  }
  const companyId = typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : null
  const source = body.source === 'style-scan' ? 'style-scan' : body.source === 'manual' ? 'manual' : 'questionnaire'

  try {
    const result = await upsertDesignContext({
      orgId: scope.orgId,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined,
      companyId,
      payload,
      source,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
      user,
    })
    return apiSuccess(result, result.created ? 201 : 200)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Could not save design context', 400)
  }
})
