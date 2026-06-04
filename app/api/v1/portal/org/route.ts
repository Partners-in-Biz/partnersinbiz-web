// GET /api/v1/portal/org
// Returns safe org fields + current user info for the logged-in client.

import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'

export const dynamic = 'force-dynamic'

type ResolvedPortalOrg =
  | { ok: true; orgId: string; userData: Record<string, unknown> }
  | { ok: false; status: number; error: string }

async function resolveOrgId(req: NextRequest, uid: string): Promise<ResolvedPortalOrg> {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  const data = userDoc.data() as { orgId?: string; activeOrgId?: string } | undefined
  if (!data) return { ok: false, status: 404, error: 'User not found' }

  const requestedOrgId = req.nextUrl.searchParams.get('orgId')?.trim() ?? ''
  if (requestedOrgId) {
    const allowed = await canUsePortalOrg(uid, data, requestedOrgId)
    if (!allowed) return { ok: false, status: 403, error: 'You do not have access to this organisation' }
    return { ok: true, orgId: requestedOrgId, userData: data as Record<string, unknown> }
  }

  const orgId = await resolvePortalActiveOrgId(uid, data)
  if (!orgId) return { ok: false, status: 404, error: 'No org linked to this account' }
  return { ok: true, orgId, userData: data as Record<string, unknown> }
}

export const GET = withPortalAuth(async (req: NextRequest, uid: string) => {
  const resolved = await resolveOrgId(req, uid)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const orgId = resolved.orgId
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()

  if (!orgDoc.exists) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  const org = orgDoc.data()!
  const user = resolved.userData

  return NextResponse.json({
    org: {
      id: orgId,
      name: org.name ?? '',
      slug: org.slug ?? '',
      type: org.type ?? 'client',
      description: org.description ?? '',
      website: org.website ?? '',
      industry: org.industry ?? '',
      billingEmail: org.billingEmail ?? '',
      logoUrl: org.logoUrl ?? '',
      plan: org.plan ?? 'starter',
      status: org.status ?? 'active',
    },
    user: {
      uid,
      name: user.name ?? '',
      email: user.email ?? '',
      role: user.role ?? 'client',
    },
  })
})
