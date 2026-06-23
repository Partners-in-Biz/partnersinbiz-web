/**
 * GET /api/v1/admin/org/[slug]/team
 *
 * Lists the org members with resolved emails / display names from Firebase
 * Auth. Read-only — team mutation lives in the org workspace, not here.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { resolveOrgBySlug, resolveOwnerUid } from '../route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)

  const members = resolved.data.members ?? []
  const ownerUid = resolveOwnerUid(resolved.data)

  const resolvedMembers = await Promise.all(
    members.map(async (m) => {
      let email = ''
      let displayName = ''
      let lastSignInTime: string | null = null
      try {
        const authUser = await adminAuth.getUser(m.userId)
        email = authUser.email ?? ''
        displayName = authUser.displayName ?? ''
        lastSignInTime = authUser.metadata.lastSignInTime ?? null
      } catch {
        /* user may have been removed from auth */
      }
      return {
        uid: m.userId,
        role: m.role ?? 'member',
        jobTitle: m.jobTitle ?? null,
        department: m.department ?? null,
        isOwner: m.userId === ownerUid,
        email,
        displayName,
        lastSignInTime,
      }
    }),
  )

  // Owner first, then by role.
  const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 }
  resolvedMembers.sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9))

  return apiSuccess({ members: resolvedMembers })
})
