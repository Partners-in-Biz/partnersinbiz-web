import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { getConversation } from '@/lib/conversations/conversations'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canReplyConversation } from '@/lib/conversations/access'
import { evaluateCrossOrgConversationAccess } from '@/lib/conversations/cross-org'
import {
  CONVERSATION_ATTACHMENT_ALLOWED_MIME,
  CONVERSATION_ATTACHMENT_MAX_BYTES,
  storeConversationAttachment,
} from '@/lib/conversations/attachments-store'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)
    const access = conversation.crossOrg
      ? await evaluateCrossOrgConversationAccess({ conversation, user, action: 'attachment.upload' })
      : null
    if (conversation.crossOrg ? !access?.allowed : !canReplyConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }
    const foreignCrossOrgParticipant = Boolean(
      conversation.crossOrg && user.orgId !== conversation.crossOrg.ownerOrgId,
    )
    if (!foreignCrossOrgParticipant) {
      const projectAuthorization = await authorizeConversationProject(user, conversation)
      if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)
    }

    const contentLengthHeader = req.headers.get('content-length')
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader)
      if (Number.isFinite(contentLength) && contentLength > CONVERSATION_ATTACHMENT_MAX_BYTES + 64 * 1024) {
        return apiError('File too large (max 10MB)', 413)
      }
    }

    const formData = await req.formData().catch(() => null)
    if (!formData) return apiError('Invalid form data', 400)

    const file = formData.get('file') as File | null
    if (!file) return apiError('No file provided', 400)
    if (file.size > CONVERSATION_ATTACHMENT_MAX_BYTES) return apiError('File too large (max 10MB)', 413)

    const contentType = (file.type || 'application/octet-stream').toLowerCase()
    if (!CONVERSATION_ATTACHMENT_ALLOWED_MIME.has(contentType)) {
      return apiError('Unsupported file type', 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.byteLength > CONVERSATION_ATTACHMENT_MAX_BYTES) return apiError('File too large (max 10MB)', 413)

    try {
      const stored = await storeConversationAttachment({
        orgId: conversation.orgId,
        conversationId: convId,
        filename: file.name,
        contentType,
        bytes: buffer,
        actor: { ...actorFrom(user) },
        ...(conversation.crossOrg ? {
          visibility: {
            principalIds: conversation.crossOrg.participants
              .filter((participant) => participant.status === 'active')
              .map((participant) => participant.principalId),
          },
        } : {}),
      })

      return apiSuccess({
        id: stored.id,
        name: stored.name,
        url: stored.url,
        contentType: stored.contentType,
        sizeBytes: stored.sizeBytes,
      }, 201)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'Unsupported file type') return apiError(message, 400)
      if (message === 'File too large (max 10MB)') return apiError(message, 413)
      console.error('[conversation-attachments] Firebase Storage error:', message)
      return apiError(`Storage error: ${message}`, 500)
    }
  },
)
