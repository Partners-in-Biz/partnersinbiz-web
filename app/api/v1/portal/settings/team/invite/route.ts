// app/api/v1/portal/settings/team/invite/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import type { OrgRole } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

const INVITABLE_ROLES = ['admin', 'member', 'viewer'] as const
type InvitableRole = typeof INVITABLE_ROLES[number]
const ACCESS_SCOPES = ['all', 'crm', 'marketing', 'projects', 'billing', 'readonly'] as const

function cleanText(value: unknown, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const POST = withPortalAuthAndRole('admin', async (req: NextRequest, _uid: string, orgId: string, callerRole: OrgRole) => {
  try {
    const body = await req.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const requestedRole = typeof body.role === 'string' ? body.role : ''
    const jobTitle = cleanText(body.jobTitle)
    const department = cleanText(body.department)
    const inviteNote = cleanText(body.inviteNote, 500)
    const requestedAccessScope = typeof body.accessScope === 'string' ? body.accessScope : ''
    const accessScope = ACCESS_SCOPES.includes(requestedAccessScope as typeof ACCESS_SCOPES[number])
      ? requestedAccessScope
      : 'all'

    if (!email || !email.includes('@')) {
      return apiError('Valid email is required', 400)
    }

    if (requestedRole && !INVITABLE_ROLES.includes(requestedRole as InvitableRole)) {
      return apiError('Invalid role. Allowed: admin, member, viewer', 400)
    }
    const role: InvitableRole = INVITABLE_ROLES.includes(requestedRole as InvitableRole)
      ? requestedRole as InvitableRole
      : 'member'

    // Callers cannot grant roles at or above their own level (owner-only privilege)
    if (callerRole !== 'owner' && ROLE_RANK[role] >= ROLE_RANK[callerRole]) {
      return apiError('You can only invite members at a lower role than your own', 403)
    }

    let targetUid: string
    let isNew = false
    try {
      const existing = await adminAuth.getUserByEmail(email)
      targetUid = existing.uid
    } catch {
      const newUser = await adminAuth.createUser({ email })
      targetUid = newUser.uid
      isNew = true
    }

    const userRef = adminDb.collection('users').doc(targetUid)
    const userDoc = await userRef.get()
    if (userDoc.exists) {
      await userRef.update({
        orgIds: FieldValue.arrayUnion(orgId),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else {
      await userRef.set({
        uid: targetUid,
        email,
        role: 'client',
        orgId,
        orgIds: [orgId],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    // Check for duplicate membership
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    const existingMembers: Array<{ userId: string }> = orgDoc.exists ? (orgDoc.data()!.members ?? []) : []
    const alreadyMember = existingMembers.some((m) => m.userId === targetUid)
    if (alreadyMember) {
      return apiError('This user is already a member of this workspace', 409)
    }

    await adminDb.collection('organizations').doc(orgId).update({
      members: FieldValue.arrayUnion({
        userId: targetUid,
        role,
        joinedAt: FieldValue.serverTimestamp(),
        ...(jobTitle ? { jobTitle } : {}),
        ...(department ? { department } : {}),
        ...(accessScope !== 'all' ? { accessScope } : {}),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    })

    await adminDb
      .collection('orgMembers')
      .doc(`${orgId}_${targetUid}`)
      .set(
        {
          orgId,
          uid: targetUid,
          firstName: '',
          lastName: '',
          jobTitle,
          department,
          accessScope,
          inviteNote,
          phone: '',
          avatarUrl: '',
          role,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    if (isNew) {
      try {
        const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
        const firebaseLink = await adminAuth.generatePasswordResetLink(email, {
          url: `${BASE_URL}/login`,
        })
        const setupLink = `${BASE_URL}/auth/reset?link=${encodeURIComponent(firebaseLink)}`
        const resend = getResendClient()
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: email,
          subject: 'You have been invited to a workspace on Partners in Biz',
          html: [
            '<p>You have been invited to join a workspace on Partners in Biz.</p>',
            jobTitle ? `<p>Role: ${escapeHtml(jobTitle)}</p>` : '',
            department ? `<p>Department: ${escapeHtml(department)}</p>` : '',
            inviteNote ? `<p>${escapeHtml(inviteNote)}</p>` : '',
            `<p><a href="${setupLink}">Set up your account &rarr;</a></p>`,
            '<p>This link expires after use. If you did not expect this email, you can ignore it.</p>',
          ].filter(Boolean).join(''),
        })
      } catch {
        // Non-fatal — user can request a password reset from the login page
      }
    }

    return NextResponse.json({ uid: targetUid, isNew })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
