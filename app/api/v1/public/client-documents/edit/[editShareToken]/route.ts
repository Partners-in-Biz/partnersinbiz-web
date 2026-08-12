import { NextRequest, NextResponse } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api/response'
import { deserializeBlocksFromFirestore } from '@/lib/client-documents/firestore-blocks'
import { stripPrivateDocumentFields } from '@/lib/client-documents/public'
import { isActiveOrgMembershipRow } from '@/lib/orgMembers/active-membership'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ editShareToken: string }> }

type EditShareDocument = {
  id: string
  orgId?: string
  editShareEnabled?: boolean
  deleted?: boolean
  currentVersionId?: string
  editAccessCode?: string
  linked?: {
    clientOrgId?: string
    clientOrgIds?: string[]
  }
  userShares?: Array<{
    userId?: string
    recipientOrgId?: string
    status?: string
    expiresAt?: string
  }>
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function linkedRecipientOrgIds(document: EditShareDocument): string[] {
  const ids = new Set<string>()
  const holderOrgId = cleanString(document.orgId)
  const primary = cleanString(document.linked?.clientOrgId)
  if (primary && primary !== holderOrgId) ids.add(primary)
  for (const raw of document.linked?.clientOrgIds ?? []) {
    const orgId = cleanString(raw)
    if (orgId && orgId !== holderOrgId) ids.add(orgId)
  }
  return Array.from(ids)
}

function hasActiveShareForUser(document: EditShareDocument, uid: string): string[] {
  const now = Date.now()
  const out = new Set<string>()
  for (const share of document.userShares ?? []) {
    if (cleanString(share?.userId) !== uid) continue
    if (cleanString(share?.status) !== 'active') continue
    if (share?.expiresAt) {
      const expiry = Date.parse(share.expiresAt)
      if (!Number.isFinite(expiry) || expiry <= now) continue
    }
    const recipientOrgId = cleanString(share?.recipientOrgId)
    if (recipientOrgId) out.add(recipientOrgId)
  }
  return Array.from(out)
}

async function isEligibleEditShareMember(document: EditShareDocument, uid: string): Promise<boolean> {
  const recipientOrgIds = new Set<string>([
    ...linkedRecipientOrgIds(document),
    ...hasActiveShareForUser(document, uid),
  ])
  for (const orgId of Array.from(recipientOrgIds)) {
    const memberSnap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    if (memberSnap.exists && isActiveOrgMembershipRow(memberSnap.data() ?? {})) return true
  }

  const holderOrgId = cleanString(document.orgId)
  if (holderOrgId && hasActiveShareForUser(document, uid).includes(holderOrgId)) {
    const userSnap = await adminDb.collection('users').doc(uid).get()
    const role = userSnap.exists ? cleanString(userSnap.data()?.role) : ''
    if (role === 'admin' || role === 'ai') return true
  }

  return false
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { editShareToken } = await ctx.params

  const snap = await adminDb
    .collection('client_documents')
    .where('editShareToken', '==', editShareToken)
    .limit(1)
    .get()
  if (snap.empty) return apiError('Not found', 404)

  const document = { id: snap.docs[0].id, ...(snap.docs[0].data() as Record<string, unknown>) } as EditShareDocument
  if (!document.editShareEnabled || document.deleted) return apiError('Link disabled', 410)

  if (document.editAccessCode) {
    const codeCookie = req.cookies.get(`eds_${editShareToken}`)?.value
    if (codeCookie !== '1') return apiError('Code verification required', 401)
  }

  const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const sessionCookie = req.cookies.get(sessionCookieName)?.value
  if (!sessionCookie) return apiError('Sign-in required', 401)

  let user
  try {
    user = await adminAuth.verifySessionCookie(sessionCookie, true)
  } catch {
    return apiError('Sign-in required', 401)
  }

  const eligible = await isEligibleEditShareMember(document, user.uid)
  if (!eligible) return apiError('This edit share is not available to your account', 403)

  if (typeof document.currentVersionId !== 'string' || !document.currentVersionId) {
    return apiError('Document missing version', 500)
  }

  const versionSnap = await adminDb
    .collection('client_documents')
    .doc(document.id)
    .collection('versions')
    .doc(document.currentVersionId)
    .get()
  if (!versionSnap.exists) return apiError('Document missing version', 500)

  const versionData = versionSnap.data()!
  const version = { id: versionSnap.id, ...versionData, blocks: deserializeBlocksFromFirestore(versionData.blocks) }

  const response = apiSuccess({
    document: stripPrivateDocumentFields(document),
    version: stripPrivateDocumentFields(version),
    user: { uid: user.uid, email: user.email ?? null },
  })
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}
