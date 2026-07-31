// app/api/v1/portal/settings/team/[uid]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import type { OrgRole } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

export const DELETE = withPortalAuthAndRole(
  'admin',
  async (_req: NextRequest, uid: string, orgId: string, _role: OrgRole, { params }: { params: Promise<{ uid: string }> }) => {
    try {
      const { uid: targetUid } = await params

      if (targetUid === uid) {
        return apiError('You cannot remove yourself', 400)
      }

      const orgRef = adminDb.collection('organizations').doc(orgId)
      const orgDoc = await orgRef.get()

      // Prevent removing the org owner
      const targetMember = (orgDoc.exists ? orgDoc.data()!.members ?? [] : []).find((m: any) => m.userId === targetUid)
      if (targetMember?.role === 'owner') {
        return apiError('Cannot remove the workspace owner', 403)
      }

      const batch = adminDb.batch()

      batch.set(
        adminDb.collection('users').doc(targetUid),
        {
          orgIds: FieldValue.arrayRemove(orgId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

      if (orgDoc.exists) {
        const members: Array<{ userId: string; role: string }> = orgDoc.data()!.members ?? []
        const member = members.find((m) => m.userId === targetUid)
        if (member) {
          batch.update(orgRef, {
            members: FieldValue.arrayRemove(member),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }

      batch.delete(adminDb.collection('orgMembers').doc(`${orgId}_${targetUid}`))

      await batch.commit()

      return NextResponse.json({ removed: targetUid })
    } catch (err) {
      return apiErrorFromException(err)
    }
  }
)

export const PATCH = withPortalAuthAndRole(
  'admin',
  async (req: NextRequest, _uid: string, orgId: string, _role: OrgRole, { params }: { params: Promise<{ uid: string }> }) => {
    try {
      const { uid: targetUid } = await params
      const body = await req.json().catch(() => ({}))

      const hasUpdates = ['jobTitle', 'department', 'accessNotes'].some((field) => Object.prototype.hasOwnProperty.call(body, field))
      if (!hasUpdates) return apiError('At least one field is required: jobTitle, department, accessNotes', 400)

      const jobTitle = Object.prototype.hasOwnProperty.call(body, 'jobTitle') && typeof body.jobTitle === 'string'
        ? body.jobTitle.trim()
        : undefined
      const department = Object.prototype.hasOwnProperty.call(body, 'department') && typeof body.department === 'string'
        ? body.department.trim()
        : undefined
      const accessNotes = Object.prototype.hasOwnProperty.call(body, 'accessNotes') && typeof body.accessNotes === 'string'
        ? body.accessNotes.trim()
        : undefined

      const orgRef = adminDb.collection('organizations').doc(orgId)
      const orgDoc = await orgRef.get()
      if (!orgDoc.exists) return apiError('Organisation not found', 404)

      const members = (orgDoc.data()?.members ?? []) as Array<{ userId?: string; uid?: string; role?: string; [k: string]: unknown }>
      const targetIndex = members.findIndex((member) => {
        const memberUid = member.userId || (member.uid as string | undefined) || ''
        return memberUid === targetUid
      })
      if (targetIndex === -1) return apiError('Team member not found', 404)

      const metadataPatch: Record<string, string> = {}
      if (Object.prototype.hasOwnProperty.call(body, 'jobTitle')) {
        metadataPatch.jobTitle = jobTitle ?? ''
      }
      if (Object.prototype.hasOwnProperty.call(body, 'department')) {
        metadataPatch.department = department ?? ''
      }
      if (Object.prototype.hasOwnProperty.call(body, 'accessNotes')) {
        metadataPatch.accessNotes = accessNotes ?? ''
      }

      const updatedMembers = [...members]
      updatedMembers[targetIndex] = {
        ...updatedMembers[targetIndex],
        ...metadataPatch,
      } as typeof updatedMembers[number]

      const batch = adminDb.batch()
      batch.set(
        adminDb.collection('orgMembers').doc(`${orgId}_${targetUid}`),
        {
          ...metadataPatch,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      batch.update(orgRef, {
        members: updatedMembers,
        updatedAt: FieldValue.serverTimestamp(),
      })
      await batch.commit()

      return NextResponse.json({
        uid: targetUid,
        ...metadataPatch,
      })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)
