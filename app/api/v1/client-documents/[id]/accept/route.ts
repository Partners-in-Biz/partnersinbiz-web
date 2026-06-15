import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { sendDocumentApprovedEmail } from '@/lib/client-documents/notifications'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { DocumentApproval } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'
import { notifyClientDocumentAccepted } from '@/lib/notifications/client-acceptance'
import {
  assertUserCanPerformOrganizationModuleAction,
  clientLinkedOrgIdForUser,
} from '@/lib/organizations/module-policy-access'

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

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

async function resolveClientCompanyName(document: { linked?: { companyId?: string; clientOrgId?: string } }) {
  const companyId = document.linked?.companyId
  if (companyId) {
    try {
      const snap = await adminDb.collection('companies').doc(companyId).get()
      if (snap.exists) {
        const data = snap.data() ?? {}
        const name = firstText(data.legalName, data.registeredName, data.companyName, data.displayName, data.name)
        if (name) return name
      }
    } catch (err) {
      console.warn('[client-documents/accept] Failed to resolve linked company name:', err)
    }
  }

  const clientOrgId = document.linked?.clientOrgId
  if (clientOrgId) {
    try {
      const snap = await adminDb.collection('organizations').doc(clientOrgId).get()
      if (snap.exists) {
        const data = snap.data() ?? {}
        const name = firstText(data.legalName, data.registeredName, data.companyName, data.displayName, data.name)
        if (name) return name
      }
    } catch (err) {
      console.warn('[client-documents/accept] Failed to resolve linked client organisation name:', err)
    }
  }

  return ''
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const document = access.document
  if (user.role !== 'client') {
    return apiError('Only a client user can formally accept on behalf of the client organisation. Use the countersign route for the Partners in Biz signature.', 403)
  }
  const approvalPolicyOrgId = clientLinkedOrgIdForUser(document.linked, user, document.orgId)
  if (approvalPolicyOrgId) {
    const approvalAccess = await assertUserCanPerformOrganizationModuleAction(
      user,
      approvalPolicyOrgId,
      'documents',
      'reviewApproval',
      'Document acceptance is disabled for your organisation role',
    )
    if (!approvalAccess.ok) return apiError(approvalAccess.error, approvalAccess.status)
  }
  if (document.approvalMode !== 'formal_acceptance') return apiError('Document does not use formal acceptance', 400)
  if (!document.latestPublishedVersionId) return apiError('Publish a version before acceptance', 400)

  const body = await req.json().catch(() => ({}))
  const actorName = typeof body.actorName === 'string' && body.actorName.trim() ? body.actorName.trim() : user.uid
  const companyName = firstText(body.companyName) || (await resolveClientCompanyName(document))
  const typedName = typeof body.typedName === 'string' ? body.typedName.trim() : ''
  const checkboxText = typeof body.checkboxText === 'string' ? body.checkboxText.trim() : ''

  if (!typedName) return apiError('typedName is required', 400)
  if (!checkboxText) return apiError('checkboxText is required', 400)

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
    signatureSide: 'client',
    actorId: user.uid,
    actorName,
    actorRole: actorRole(user),
    companyName,
    typedName,
    checkboxText,
    termsSnapshot: body.termsSnapshot ?? null,
    investmentSnapshot: body.investmentSnapshot ?? null,
    ip,
    userAgent,
    createdAt: now,
  })
  batch.update(documentRef, {
    status: 'accepted',
    clientAcceptance: {
      versionId: document.latestPublishedVersionId,
      actorId: user.uid,
      actorName,
      typedName,
      ...(companyName ? { companyName } : {}),
      checkboxText,
      acceptedAt: now,
      ip,
      userAgent,
    },
    updatedAt: now,
    updatedBy: user.uid,
    updatedByType: actorType(user),
  })

  await batch.commit()

  // Fire-and-forget: notify PiB team inbox
  void (async () => {
    try {
      const approval: DocumentApproval = {
        id: approvalRef.id,
        documentId: id,
        versionId: document.latestPublishedVersionId!,
        mode: 'formal_acceptance',
        actorId: user.uid,
        actorName,
        actorRole: actorRole(user),
        companyName,
        typedName,
        checkboxText,
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
          mode: 'formal_acceptance',
        })
      }
    } catch (err) {
      console.error('[client-documents/accept] Notification failed:', err)
    }
  })()

  return apiSuccess({ id: approvalRef.id, versionId: document.latestPublishedVersionId })
})
