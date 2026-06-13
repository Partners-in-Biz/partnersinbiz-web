import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import type { OrgMember, OrgRole } from '@/lib/organizations/types'
import {
  accessSummaryForPolicy,
  normalizeMemberAccessPolicy,
  resolveMemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ uid: string }> }
type StoredMember = OrgMember & { uid?: string }

function memberUid(member: StoredMember): string {
  return member.userId || member.uid || ''
}

async function loadMemberAccess(orgId: string, targetUid: string) {
  const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${targetUid}`).get()
  if (memberDoc.exists) {
    const data = memberDoc.data() ?? {}
    const role = data.role as OrgRole
    const accessPolicy = resolveMemberAccessPolicy({
      role,
      accessScope: data.accessScope,
      accessPolicy: data.accessPolicy,
    })
    return {
      exists: true,
      role,
      accessScope: typeof data.accessScope === 'string' ? data.accessScope : '',
      accessPolicy,
    }
  }

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  const members = (orgDoc.exists ? orgDoc.data()?.members : []) as StoredMember[]
  const fallback = members.find((member) => memberUid(member) === targetUid)
  if (!fallback) return { exists: false as const }

  const role = fallback.role as OrgRole
  const accessPolicy = resolveMemberAccessPolicy({
    role,
    accessScope: fallback.accessScope,
    accessPolicy: fallback.accessPolicy,
  })
  return {
    exists: true,
    role,
    accessScope: fallback.accessScope ?? '',
    accessPolicy,
  }
}

export const GET = withPortalAuthAndRole(
  'owner',
  async (_req: NextRequest, _uid: string, orgId: string, _role: OrgRole, { params }: RouteCtx) => {
    try {
      const { uid: targetUid } = await params
      const loaded = await loadMemberAccess(orgId, targetUid)
      if (!loaded.exists) return apiError('Team member not found', 404)

      return NextResponse.json({
        uid: targetUid,
        role: loaded.role,
        accessScope: loaded.accessScope,
        accessPolicy: loaded.accessPolicy,
        accessSummary: accessSummaryForPolicy(loaded.accessPolicy),
      })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)

export const PATCH = withPortalAuthAndRole(
  'owner',
  async (req: NextRequest, _uid: string, orgId: string, _role: OrgRole, { params }: RouteCtx) => {
    try {
      const { uid: targetUid } = await params
      const body = await req.json().catch(() => ({}))
      const loaded = await loadMemberAccess(orgId, targetUid)
      if (!loaded.exists) return apiError('Team member not found', 404)
      if (loaded.role === 'owner') return apiError('Cannot change the access policy of the workspace owner', 403)

      const accessPolicy = normalizeMemberAccessPolicy((body as { accessPolicy?: unknown }).accessPolicy)
      const orgRef = adminDb.collection('organizations').doc(orgId)
      const orgDoc = await orgRef.get()
      const batch = adminDb.batch()

      batch.set(
        adminDb.collection('orgMembers').doc(`${orgId}_${targetUid}`),
        {
          accessPolicy,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      if (orgDoc.exists) {
        const members = ((orgDoc.data()?.members ?? []) as StoredMember[]).map((member) => (
          memberUid(member) === targetUid ? { ...member, accessPolicy } : member
        ))
        batch.update(orgRef, { members, updatedAt: FieldValue.serverTimestamp() })
      }

      await batch.commit()

      return NextResponse.json({
        uid: targetUid,
        role: loaded.role,
        accessPolicy,
        accessSummary: accessSummaryForPolicy(accessPolicy),
      })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)
