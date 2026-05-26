// GET /api/v1/portal/org
// Returns safe org fields + current user info for the logged-in client.

import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { resolvePortalActiveOrgId } from '@/lib/portal/org-access'

export const dynamic = 'force-dynamic'

async function resolveOrgId(uid: string): Promise<string | null> {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  const data = userDoc.data() as { orgId?: string; activeOrgId?: string } | undefined
  if (!data) return null
  return resolvePortalActiveOrgId(uid, data)
}

export const GET = withPortalAuth(async (_req: NextRequest, uid: string) => {
  const orgId = await resolveOrgId(uid)
  if (!orgId) return NextResponse.json({ error: 'No org linked to this account' }, { status: 404 })

  const [orgDoc, userDoc] = await Promise.all([
    adminDb.collection('organizations').doc(orgId).get(),
    adminDb.collection('users').doc(uid).get(),
  ])

  if (!orgDoc.exists) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  const org = orgDoc.data()!
  const user = userDoc.data()!

  return NextResponse.json({
    org: {
      id: orgId,
      name: org.name ?? '',
      slug: org.slug ?? '',
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
