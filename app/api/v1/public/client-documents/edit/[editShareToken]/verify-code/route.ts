import { NextRequest, NextResponse } from 'next/server'

import { apiError } from '@/lib/api/response'
import { logDocumentAccess, verifyAccessCode } from '@/lib/client-documents/editShare'
import { adminDb } from '@/lib/firebase/admin'
import { checkAndIncrementRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ editShareToken: string }> }

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  // PUBLIC: edit-share access-code verification, rate-limited per token and IP.
  const { editShareToken } = await ctx.params
  const { code } = (await req.json().catch(() => ({}))) as { code?: string }
  if (!code) return apiError('Code required', 400)

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const limit = await checkAndIncrementRateLimit({
    key: `code:${ip}:${editShareToken}`,
    limit: 5,
    windowMs: 15 * 60 * 1000,
  })
  if (!limit.allowed) return apiError('Too many attempts. Try again later.', 429)

  const docSnap = await adminDb
    .collection('client_documents')
    .where('editShareToken', '==', editShareToken)
    .limit(1)
    .get()
  if (docSnap.empty) return apiError('Invalid link', 404)
  const docRef = docSnap.docs[0].ref
  const doc = docSnap.docs[0].data() as { editShareEnabled?: boolean; editAccessCode?: string; deleted?: boolean }
  if (!doc.editShareEnabled || doc.deleted) return apiError('Link disabled', 410)

  const valid = verifyAccessCode(doc.editAccessCode, code)
  await logDocumentAccess(docRef.id, {
    type: valid ? 'code_entered' : 'code_failed',
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  })
  if (!valid) return apiError('Incorrect code', 401)

  const response = NextResponse.json({ success: true, data: { codeAccepted: true } })
  response.cookies.set({
    name: `eds_${editShareToken}`,
    value: '1',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60,
    path: '/',
  })
  return response
}
