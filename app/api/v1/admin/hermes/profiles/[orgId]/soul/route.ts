/**
 * GET /api/v1/admin/hermes/profiles/[orgId]/soul
 *   Reads the agent profile/SOUL document from the linked Hermes dashboard
 *   (`/api/profile`). Returns the raw profile payload so the operator can view
 *   the current SOUL.md / persona configuration.
 *
 * PUT /api/v1/admin/hermes/profiles/[orgId]/soul
 *   Updates the SOUL/persona on the linked Hermes profile. Body { soul }.
 *   Proxied to the dashboard `/api/profile` (PUT). Super-admin only; audited.
 *
 * Auth: admin (read requires dashboard capability; write requires super-admin).
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import {
  callHermesAdminControl,
  requireHermesProfileAccess,
  resolveHermesAdminControl,
} from '@/lib/hermes/server'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ orgId: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as RouteContext).params
  const resolved = resolveHermesAdminControl('profile', [], 'GET')
  if ('error' in resolved) return apiError(resolved.error, resolved.status)

  const access = await requireHermesProfileAccess(user, orgId, resolved.capability)
  if (access instanceof Response) return access

  const { response, data } = await callHermesAdminControl(access.link, resolved.path, 'GET')
  if (!response.ok) return apiError('Failed to read Hermes SOUL/profile', response.status === 404 ? 404 : 502, { upstream: data })
  return apiSuccess({ orgId, profile: access.link.profile, soul: data })
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can edit a Hermes SOUL', 403)
  const { orgId } = await (ctx as RouteContext).params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }
  const soul = typeof body.soul === 'string' ? body.soul : ''
  if (!soul.trim()) return apiError('soul (SOUL.md content) is required', 400)

  const resolved = resolveHermesAdminControl('profile', [], 'PUT')
  if ('error' in resolved) return apiError(resolved.error, resolved.status)

  const access = await requireHermesProfileAccess(user, orgId, resolved.capability)
  if (access instanceof Response) return access

  const { response, data } = await callHermesAdminControl(
    access.link,
    resolved.path,
    'PUT',
    JSON.stringify({ soul }),
  )
  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: 'Hermes rejected the SOUL update', upstream: data },
      { status: response.status >= 400 ? response.status : 502 },
    )
  }

  await writeAdminAudit(user, {
    action: 'hermes.edit_soul',
    orgId,
    summary: `Edited Hermes SOUL for ${access.link.profile} (org ${orgId})`,
    metadata: { orgId, profile: access.link.profile, soulLength: soul.length },
  })

  return apiSuccess({ orgId, profile: access.link.profile, updated: true, soul: data })
})
