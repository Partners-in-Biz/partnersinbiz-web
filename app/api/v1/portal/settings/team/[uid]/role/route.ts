// app/api/v1/portal/settings/team/[uid]/role/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import type { OrgRole } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'member', 'viewer']

export const PATCH = withPortalAuthAndRole(
  'admin',
  async (req: NextRequest, _uid: string, orgId: string, _role: OrgRole, { params }: { params: Promise<{ uid: string }> }) => {
    try {
      const { uid: targetUid } = await params
      const body = await req.json().catch(() => ({}))
      const newRole = body.role as OrgRole

      if (!ASSIGNABLE_ROLES.includes(newRole)) {
        return apiError('Invalid role. Allowed: admin, member, viewer', 400)
      }

      // Cannot demote the current workspace owner
      const targetMemberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${targetUid}`).get()
      if (targetMemberDoc.exists && targetMemberDoc.data()!.role === 'owner') {
        return apiError('Cannot change the role of the workspace owner', 403)
      }

      // Atomic batch: update orgMembers + org.members array together
      const orgRef = adminDb.collection('organizations').doc(orgId)
      const orgDoc = await orgRef.get()

      const batch = adminDb.batch()

      batch.set(
        adminDb.collection('orgMembers').doc(`${orgId}_${targetUid}`),
        { role: newRole, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      )

      if (orgDoc.exists) {
        const members: Array<{ userId: string; role: string }> = orgDoc.data()!.members ?? []
        const updated = members.map((m) => (m.userId === targetUid ? { ...m, role: newRole } : m))
        batch.update(orgRef, { members: updated, updatedAt: FieldValue.serverTimestamp() })
      }

      await batch.commit()

      return NextResponse.json({ uid: targetUid, role: newRole })
    } catch (err) {
      return apiErrorFromException(err)
    }
  }
)
