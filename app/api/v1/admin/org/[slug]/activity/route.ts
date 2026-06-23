/**
 * GET /api/v1/admin/org/[slug]/activity
 *
 * Returns the platform-admin audit trail scoped to this org via readAdminAudit.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { readAdminAudit } from '@/lib/admin/audit'
import { resolveOrgBySlug } from '../route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

export const GET = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)

  const limitParam = Number(new URL(req.url).searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100

  const entries = await readAdminAudit({ orgId: resolved.id, limit })
  return apiSuccess({ entries })
})
