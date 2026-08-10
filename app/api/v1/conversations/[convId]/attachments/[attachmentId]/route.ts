import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'

import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canAccessConversation } from '@/lib/conversations/access'
import { getConversation } from '@/lib/conversations/conversations'
import { evaluateCrossOrgConversationAccess } from '@/lib/conversations/cross-org'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string; attachmentId: string }> }

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId, attachmentId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)
    const access = conversation.crossOrg
      ? await evaluateCrossOrgConversationAccess({
        conversation, user, action: 'attachment.read', item: attachmentId,
      })
      : null
    if (conversation.crossOrg ? !access?.allowed : !canAccessConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }
    const foreignCrossOrgParticipant = Boolean(
      conversation.crossOrg && user.orgId !== conversation.crossOrg.ownerOrgId,
    )
    if (!foreignCrossOrgParticipant) {
      const projectAuthorization = await authorizeConversationProject(user, conversation)
      if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)
    }

    const attachmentDoc = await adminDb.collection('conversation_attachments').doc(attachmentId).get()
    if (!attachmentDoc.exists) return apiError('Attachment not found', 404)
    const attachment = attachmentDoc.data() ?? {}
    if (attachment.conversationId !== convId || attachment.orgId !== conversation.orgId || attachment.deleted === true) {
      return apiError('Attachment not found', 404)
    }
    if (conversation.crossOrg) {
      const principalIds = Array.isArray((attachment.visibility as { principalIds?: unknown } | undefined)?.principalIds)
        ? (attachment.visibility as { principalIds: unknown[] }).principalIds.filter((value): value is string => typeof value === 'string')
        : []
      if (!access?.principalId || !principalIds.includes(access.principalId)) {
        return apiError('Attachment not found', 404)
      }
    }
    const storagePath = typeof attachment.storagePath === 'string' ? attachment.storagePath : ''
    if (!storagePath) return apiError('Attachment not found', 404)

    const [buffer] = await getStorage(getAdminApp()).bucket().file(storagePath).download()
    const contentType = typeof attachment.contentType === 'string' ? attachment.contentType : 'application/octet-stream'
    const fileName = typeof attachment.name === 'string' ? attachment.name.replace(/["\r\n]/g, '_') : 'attachment'
    return new Response(Uint8Array.from(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  },
)
