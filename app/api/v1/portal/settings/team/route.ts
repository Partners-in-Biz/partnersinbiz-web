// app/api/v1/portal/settings/team/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiErrorFromException } from '@/lib/api/response'
import type { OrgRole } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string) => {
  try {
    const snapshot = await adminDb
      .collection('orgMembers')
      .where('orgId', '==', orgId)
      .get()

    const members = await Promise.all(snapshot.docs.map(async (d) => {
      const data = d.data()
      const prefix = `${orgId}_`
      const uid = (data.uid as string | undefined) ?? (d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id)
      const userDoc = uid ? await adminDb.collection('users').doc(uid).get() : null
      const userData = userDoc?.data() ?? {}
      const displayName = (userData.displayName as string | undefined) ?? ''
      const [fallbackFirst = '', ...fallbackRest] = displayName.trim().split(/\s+/).filter(Boolean)

      return {
        uid,
        firstName: ((data.firstName as string | undefined) ?? fallbackFirst) || '',
        lastName: ((data.lastName as string | undefined) ?? fallbackRest.join(' ')) || '',
        jobTitle: (data.jobTitle as string) ?? '',
        avatarUrl: ((data.avatarUrl as string | undefined) ?? (userData.photoURL as string | undefined)) || '',
        role: data.role as OrgRole,
      }
    }))

    return NextResponse.json({ members })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
