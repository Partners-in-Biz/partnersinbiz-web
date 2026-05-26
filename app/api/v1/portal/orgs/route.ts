// GET /api/v1/portal/orgs
// Returns all organisations the logged-in client belongs to.
// Used by the portal sidebar org-switcher.

import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { choosePortalActiveOrgId, getPortalOrgIdsForUser } from '@/lib/portal/org-access'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuth(async (_req: NextRequest, uid: string) => {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const data = userDoc.data()!
  const orgIds = await getPortalOrgIdsForUser(uid, data)

  if (!orgIds.length) return NextResponse.json({ orgs: [], activeOrgId: null })

  const orgDocs = await Promise.all(
    orgIds.map((id) => adminDb.collection('organizations').doc(id).get()),
  )

  const orgs = orgDocs
    .filter((d) => d.exists)
    .map((d) => ({
      id: d.id,
      name: (d.data()!.name as string) ?? '',
      slug: (d.data()!.slug as string) ?? '',
      type: (d.data()!.type as string) ?? 'client',
      logoUrl: (d.data()!.logoUrl as string) ?? '',
    }))

  const activeOrgId = choosePortalActiveOrgId(data, orgIds) ?? orgs[0]?.id ?? null
  return NextResponse.json({ orgs, activeOrgId })
})
