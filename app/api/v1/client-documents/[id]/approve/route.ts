import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { sendDocumentApprovedEmail } from '@/lib/client-documents/notifications'
import { generateApprovedDocumentProjectTasks } from '@/lib/client-documents/taskGeneration'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { DocumentApproval } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'
import { notifyClientDocumentAccepted } from '@/lib/notifications/client-acceptance'

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

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const document = access.document
  if (document.approvalMode !== 'operational') return apiError('Document does not use operational approval', 400)
  if (!document.latestPublishedVersionId) return apiError('Publish a version before approval', 400)

  const body = await req.json().catch(() => ({}))
  const actorName = typeof body.actorName === 'string' && body.actorName.trim() ? body.actorName.trim() : user.uid
  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''
  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const approvalRef = documentRef.collection('approvals').doc()
  const batch = adminDb.batch()

  batch.set(approvalRef, {
    documentId: id,
    versionId: document.latestPublishedVersionId,
    mode: 'operational',
    actorId: user.uid,
    actorName,
    actorRole: actorRole(user),
    companyName,
    ip: firstForwardedIp(req),
    userAgent: req.headers.get('user-agent') ?? '',
    createdAt: FieldValue.serverTimestamp(),
  })
  batch.update(documentRef, {
    status: 'approved',
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedByType: actorType(user),
  })

  await batch.commit()

  let generatedProjectTasks: { projectId: string; taskIds: string[] } | undefined
  if (body.generateProjectTasks) {
    const plan = body.generateProjectTasks === true ? {} : body.generateProjectTasks
    const taskGeneration = await generateApprovedDocumentProjectTasks({
      document,
      approvalId: approvalRef.id,
      actorId: user.uid,
      plan,
    })
    if (!taskGeneration.ok) return apiError(taskGeneration.error, taskGeneration.status)
    generatedProjectTasks = { projectId: taskGeneration.projectId, taskIds: taskGeneration.createdTaskIds }
  }

  // Fire-and-forget: notify PiB team inbox
  void (async () => {
    try {
      const approval: DocumentApproval = {
        id: approvalRef.id,
        documentId: id,
        versionId: document.latestPublishedVersionId!,
        mode: 'operational',
        actorId: user.uid,
        actorName,
        actorRole: actorRole(user),
        companyName,
      }
      await sendDocumentApprovedEmail(document, approval, 'notifications@partnersinbiz.online', 'Partners in Biz Team')
      if (document.orgId) {
        await notifyClientDocumentAccepted({
          orgId: document.orgId,
          documentId: id,
          documentTitle: document.title,
          versionId: document.latestPublishedVersionId!,
          approvalId: approvalRef.id,
          actorName,
          mode: 'operational',
        })
      }
    } catch (err) {
      console.error('[client-documents/approve] Notification failed:', err)
    }
  })()

  return apiSuccess({
    id: approvalRef.id,
    versionId: document.latestPublishedVersionId,
    ...(generatedProjectTasks ? { generatedProjectTasks } : {}),
  })
})
