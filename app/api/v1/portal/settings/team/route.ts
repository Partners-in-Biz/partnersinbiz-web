// app/api/v1/portal/settings/team/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiErrorFromException } from '@/lib/api/response'
import type { OrgMember, OrgRole } from '@/lib/organizations/types'
import {
  accessSummaryForPolicy,
  resolveMemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'

export const dynamic = 'force-dynamic'

type StoredMember = OrgMember & {
  uid?: string
  displayName?: string
  photoURL?: string
}

function splitName(displayName: string) {
  const [firstName = '', ...rest] = displayName.trim().split(/\s+/).filter(Boolean)
  return { firstName, lastName: rest.join(' ') }
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string) => {
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    const orgMembers = (orgDoc.exists ? orgDoc.data()?.members : []) as StoredMember[]

    if (orgMembers.length > 0) {
      const members = await Promise.all(orgMembers.map(async (member) => {
        const uid = member.userId || member.uid || ''
        const [profileDoc, userDoc] = uid
          ? await Promise.all([
              adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get(),
              adminDb.collection('users').doc(uid).get(),
            ])
          : [null, null] as const
        const profileData = profileDoc?.data() ?? {}
        const userData = userDoc?.data() ?? {}
        const displayName = (member.displayName || userData.displayName || '') as string
        const fallback = splitName(displayName)
        const role = member.role as OrgRole
        const accessScope = (profileData.accessScope as string | undefined) ?? member.accessScope ?? ''
        const accessPolicy = resolveMemberAccessPolicy({
          role,
          accessScope,
          accessPolicy: profileData.accessPolicy ?? member.accessPolicy,
        })

        return {
          uid,
          firstName: ((profileData.firstName as string | undefined) ?? fallback.firstName) || '',
          lastName: ((profileData.lastName as string | undefined) ?? fallback.lastName) || '',
          jobTitle: (profileData.jobTitle as string | undefined) ?? '',
          department: (profileData.department as string | undefined) ?? '',
          accessScope,
          accessPolicy,
          accessSummary: accessSummaryForPolicy(accessPolicy),
          avatarUrl: ((profileData.avatarUrl as string | undefined) ?? member.photoURL ?? (userData.photoURL as string | undefined)) || '',
          role,
        }
      }))

      return NextResponse.json({ members })
    }

    // Legacy fallback for orgs that have not had organizations.members backfilled yet.
    const snapshot = await adminDb.collection('orgMembers').where('orgId', '==', orgId).get()
    const members = await Promise.all(snapshot.docs.map(async (d) => {
      const data = d.data()
      const prefix = `${orgId}_`
      const uid = (data.uid as string | undefined) ?? (d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id)
      const userDoc = uid ? await adminDb.collection('users').doc(uid).get() : null
      const userData = userDoc?.data() ?? {}
      const displayName = (userData.displayName as string | undefined) ?? ''
      const fallback = splitName(displayName)
      const role = data.role as OrgRole
      const accessPolicy = resolveMemberAccessPolicy({
        role,
        accessScope: data.accessScope,
        accessPolicy: data.accessPolicy,
      })

      return {
        uid,
        firstName: ((data.firstName as string | undefined) ?? fallback.firstName) || '',
        lastName: ((data.lastName as string | undefined) ?? fallback.lastName) || '',
        jobTitle: (data.jobTitle as string) ?? '',
        department: (data.department as string) ?? '',
        accessScope: (data.accessScope as string) ?? '',
        accessPolicy,
        accessSummary: accessSummaryForPolicy(accessPolicy),
        avatarUrl: ((data.avatarUrl as string | undefined) ?? (userData.photoURL as string | undefined)) || '',
        role,
      }
    }))

    return NextResponse.json({ members })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
