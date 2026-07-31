/**
 * Conversation-scoped mention notifications with Messages deep-links and push.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { resolveOrgSlugForLink } from '@/lib/projects/links'
import { sendPushToUser } from '@/lib/notifications/push'
import type { Mention } from './types'

export function buildConversationMentionLink(input: {
  orgSlug?: string | null
  conversationId: string
  messageId?: string
}): string {
  const qs = new URLSearchParams()
  qs.set('convId', input.conversationId)
  if (input.messageId) qs.set('messageId', input.messageId)
  if (input.orgSlug) {
    return `/admin/org/${encodeURIComponent(input.orgSlug)}/messages?${qs.toString()}`
  }
  return `/admin/messages?${qs.toString()}`
}

export async function notifyConversationMentions(params: {
  orgId: string
  conversationId: string
  messageId: string
  mentions: Mention[]
  actorName: string
  snippet: string
  /** When true (default), also attempt FCM push for user mentions with registered devices. */
  sendPush?: boolean
}): Promise<{ notifiedUserIds: string[]; pushAttempted: number }> {
  const userMentions = params.mentions.filter((m) => m.type === 'user' && m.id)
  if (userMentions.length === 0) return { notifiedUserIds: [], pushAttempted: 0 }

  const orgSlug = await resolveOrgSlugForLink(adminDb, params.orgId).catch(() => null)
  const link = buildConversationMentionLink({
    orgSlug,
    conversationId: params.conversationId,
    messageId: params.messageId,
  })

  const batch = adminDb.batch()
  const notifsRef = adminDb.collection('notifications')
  const notifiedUserIds: string[] = []
  const seen = new Set<string>()

  for (const m of userMentions) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    notifiedUserIds.push(m.id)
    const ref = notifsRef.doc()
    batch.set(ref, {
      orgId: params.orgId,
      userId: m.id,
      agentId: null,
      type: 'mention',
      title: `${params.actorName} mentioned you`,
      body: params.snippet,
      link,
      status: 'unread',
      priority: 'normal',
      data: {
        commentId: params.messageId,
        resourceType: 'conversation',
        resourceId: params.conversationId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        surface: 'messages',
      },
      createdAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()

  let pushAttempted = 0
  if (params.sendPush !== false) {
    await Promise.all(notifiedUserIds.map(async (uid) => {
      const result = await sendPushToUser(uid, {
        title: `${params.actorName} mentioned you`,
        body: params.snippet,
        link,
        data: {
          type: 'mention',
          conversationId: params.conversationId,
          messageId: params.messageId,
        },
      }).catch(() => ({ attempted: 0, delivered: 0, pruned: 0 }))
      pushAttempted += result.attempted
    }))
  }

  return { notifiedUserIds, pushAttempted }
}
