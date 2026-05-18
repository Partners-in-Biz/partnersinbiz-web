import { NextRequest, NextResponse } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api/response'
import { deserializeBlocksFromFirestore } from '@/lib/client-documents/firestore-blocks'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ editShareToken: string }> }

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { editShareToken } = await ctx.params

  const codeCookie = req.cookies.get(`eds_${editShareToken}`)?.value
  if (codeCookie !== '1') return apiError('Code verification required', 401)

  const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const sessionCookie = req.cookies.get(sessionCookieName)?.value
  if (!sessionCookie) return apiError('Sign-in required', 401)

  let user
  try {
    user = await adminAuth.verifySessionCookie(sessionCookie, true)
  } catch {
    return apiError('Sign-in required', 401)
  }

  const snap = await adminDb
    .collection('client_documents')
    .where('editShareToken', '==', editShareToken)
    .limit(1)
    .get()
  if (snap.empty) return apiError('Not found', 404)

  const doc = { id: snap.docs[0].id, ...(snap.docs[0].data() as Record<string, unknown>) } as {
    id: string
    editShareEnabled?: boolean
    deleted?: boolean
    currentVersionId?: string
  }
  if (!doc.editShareEnabled || doc.deleted) return apiError('Link disabled', 410)

  if (typeof doc.currentVersionId !== 'string' || !doc.currentVersionId) {
    return apiError('Document missing version', 500)
  }

  const versionSnap = await adminDb
    .collection('client_documents')
    .doc(doc.id)
    .collection('versions')
    .doc(doc.currentVersionId)
    .get()
  if (!versionSnap.exists) return apiError('Document missing version', 500)

  const versionData = versionSnap.data()!
  const version = { id: versionSnap.id, ...versionData, blocks: deserializeBlocksFromFirestore(versionData.blocks) }

  return apiSuccess({
    document: doc,
    version,
    user: { uid: user.uid, email: user.email ?? null },
  })
}
