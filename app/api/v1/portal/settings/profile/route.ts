import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import type { OrgRole } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

async function resolveOrgId(uid: string): Promise<string | null> {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) return null
  const d = userDoc.data()!
  return (d.activeOrgId ?? d.orgId ?? null) as string | null
}

function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && value in ROLE_RANK
}

async function resolveMemberRole(orgId: string, uid: string): Promise<OrgRole | null> {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return null
  const members: Array<{ userId?: string; role?: unknown }> = orgDoc.data()?.members ?? []
  const member = members.find((item) => item.userId === uid)
  return isOrgRole(member?.role) ? member.role : null
}

export const GET = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    const orgId = await resolveOrgId(uid)
    if (!orgId) return apiError('No active workspace', 400)

    const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    if (!memberDoc.exists) {
      const fallbackRole = await resolveMemberRole(orgId, uid)
      return NextResponse.json({
        profile: { firstName: '', lastName: '', jobTitle: '', phone: '', avatarUrl: '', role: fallbackRole, profileBannerDismissed: false },
      })
    }

    const d = memberDoc.data()!
    const role = isOrgRole(d.role) ? d.role : await resolveMemberRole(orgId, uid)
    return NextResponse.json({
      profile: {
        firstName: d.firstName ?? '',
        lastName: d.lastName ?? '',
        jobTitle: d.jobTitle ?? '',
        phone: d.phone ?? '',
        avatarUrl: d.avatarUrl ?? '',
        role,
        profileBannerDismissed: d.profileBannerDismissed ?? false,
      },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const orgId = await resolveOrgId(uid)
    if (!orgId) return apiError('No active workspace', 400)

    const body = await req.json().catch(() => ({}))
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
    const profileBannerDismissed = body.profileBannerDismissed === true

    if (!firstName && !profileBannerDismissed) {
      return apiError('firstName is required', 400)
    }

    // Get existing doc for role + createdAt handling
    const existingDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    const existingRoleValue = existingDoc.exists ? existingDoc.data()!.role : null
    const existingRole = isOrgRole(existingRoleValue) ? existingRoleValue : await resolveMemberRole(orgId, uid)

    if (!firstName && profileBannerDismissed) {
      // Dismiss-only — only write the flag, never touch profile fields
      await adminDb
        .collection('orgMembers')
        .doc(`${orgId}_${uid}`)
        .set(
          {
            ...(existingRole ? { role: existingRole } : {}),
            profileBannerDismissed: true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      return NextResponse.json({ profile: { ...(existingDoc.data() ?? {}), profileBannerDismissed: true, role: existingRole } })
    }

    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
    const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim() : ''
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : ''

    await adminDb
      .collection('orgMembers')
      .doc(`${orgId}_${uid}`)
      .set(
        {
          orgId,
          uid,
          firstName,
          lastName,
          jobTitle,
          phone,
          avatarUrl,
          ...(existingRole ? { role: existingRole } : {}),
          ...(profileBannerDismissed ? { profileBannerDismissed: true } : {}),
          ...(!existingDoc.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return NextResponse.json({ profile: { firstName, lastName, jobTitle, phone, avatarUrl, profileBannerDismissed, role: existingRole } })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
