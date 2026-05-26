// GET  /api/v1/portal/active-org  — returns current active orgId
// POST /api/v1/portal/active-org  — switches active org (must be in user's orgIds)

import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuth(async (_req: NextRequest, uid: string) => {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const data = userDoc.data()!
  const activeOrgId = await resolvePortalActiveOrgId(uid, data)
  return NextResponse.json({ orgId: activeOrgId })
})

export const POST = withPortalAuth(async (req: NextRequest, uid: string) => {
  const body = await req.json().catch(() => ({}))
  const orgId: string = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const data = userDoc.data()!
  if (!await canUsePortalOrg(uid, data, orgId)) {
    return NextResponse.json({ error: 'You do not have access to this organisation' }, { status: 403 })
  }

  await adminDb.collection('users').doc(uid).update({
    activeOrgId: orgId,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return NextResponse.json({ orgId })
})
