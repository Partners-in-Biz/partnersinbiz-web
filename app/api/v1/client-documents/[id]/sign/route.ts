import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function actorType(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : 'user'
}

function actorRole(user: ApiUser) {
  return user.role === 'ai' ? 'ai' : user.role
}

function firstForwardedIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
}

function requiredText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const document = access.document
  if (document.approvalMode !== 'formal_acceptance') {
    return apiError('Document does not use formal acceptance', 400)
  }
  if (!document.latestPublishedVersionId) return apiError('Publish a version before countersigning', 400)

  const body = await req.json().catch(() => ({}))
  const name = requiredText(body.name)
  const capacity = requiredText(body.capacity)
  const signatureText = requiredText(body.signatureText)
  const companyName = requiredText(body.companyName) || 'The Partners in Business'
  const statement = requiredText(body.statement) || 'Signed electronically for Partners in Biz.'

  if (!name) return apiError('name is required', 400)
  if (!capacity) return apiError('capacity is required', 400)
  if (!signatureText) return apiError('signatureText is required', 400)

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const approvalRef = documentRef.collection('approvals').doc()
  const batch = adminDb.batch()
  const now = FieldValue.serverTimestamp()
  const ip = firstForwardedIp(req)
  const userAgent = req.headers.get('user-agent') ?? ''

  batch.set(approvalRef, {
    documentId: id,
    versionId: document.latestPublishedVersionId,
    mode: 'formal_acceptance',
    signatureSide: 'provider',
    actorId: user.uid,
    actorName: name,
    actorRole: actorRole(user),
    companyName,
    capacity,
    typedName: signatureText,
    checkboxText: statement,
    ip,
    userAgent,
    createdAt: now,
  })
  batch.update(documentRef, {
    providerSignature: {
      versionId: document.latestPublishedVersionId,
      name,
      capacity,
      companyName,
      signatureText,
      statement,
      signedBy: user.uid,
      signedByType: actorType(user),
      signedAt: now,
      ip,
      userAgent,
    },
    updatedAt: now,
    updatedBy: user.uid,
    updatedByType: actorType(user),
  })

  await batch.commit()

  return apiSuccess({ id: approvalRef.id, versionId: document.latestPublishedVersionId })
})
