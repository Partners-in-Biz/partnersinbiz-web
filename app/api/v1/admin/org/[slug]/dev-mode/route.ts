/**
 * POST / PUT  /api/v1/admin/org/[slug]/dev-mode (US-324)
 *
 * Toggles the org's dev-mode flag. When enabled, `settings.portalDevBanner` is
 * also set so the client portal renders a "development workspace" banner.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { resolveOrgBySlug } from '../route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

async function handle(req: NextRequest, user: Parameters<Parameters<typeof withAuth>[1]>[1], ctx: RouteContext) {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)

  const { slug } = await ctx.params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)
  const { id, data: org } = resolved

  const body = await req.json().catch(() => ({}))
  const enabled = body?.enabled === true

  await adminDb.collection('organizations').doc(id).update({
    devMode: enabled,
    'settings.portalDevBanner': enabled,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeAdminAudit(user, {
    action: 'org.dev_mode',
    orgId: id,
    summary: `${enabled ? 'Enabled' : 'Disabled'} dev mode for "${org.name ?? slug}"`,
    metadata: { slug, enabled },
  })

  return apiSuccess({ id, devMode: enabled })
}

export const POST = withAuth('admin', (req, user, ctx) => handle(req, user, ctx as RouteContext))
export const PUT = withAuth('admin', (req, user, ctx) => handle(req, user, ctx as RouteContext))
