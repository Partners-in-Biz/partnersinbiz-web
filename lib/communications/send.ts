/**
 * Outbound send dispatcher for approved conversation messages.
 *
 * Workstream 1 (communications-whatsapp-connector-2026-08-06):
 *   - Human approval gate stays server-side: only messages created with
 *     `sendNow=true` + `humanApproved=true` reach this dispatcher.
 *   - Per-org Twilio credentials (encrypted at rest) are used when the org has
 *     connected its own WhatsApp sender; otherwise the platform env-var
 *     account remains the fallback.
 *   - The statusCallbackUrl points at the per-org webhook route so Twilio
 *     delivery callbacks (delivered/read/failed) land back in the right org.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getCommunicationProviderForChannel } from './providers'
import {
  addConversationMessage,
  COMMUNICATION_COLLECTIONS,
  getConversation,
  getConversationMessage,
  getOrgTwilioCredentials,
  recordCommunicationEvent,
} from './store'

function platformBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
}

export interface SendConversationMessageResult {
  ok: boolean
  status: 'queued' | 'sent' | 'failed'
  providerMessageId?: string
  error?: string
}

/**
 * Dispatch one approved outbound message through the org's provider.
 * Returns immediately when there is nothing to send (not queued / no recipient).
 */
export async function sendApprovedConversationMessage(
  orgId: string,
  messageId: string,
): Promise<SendConversationMessageResult> {
  const message = await getConversationMessage(orgId, messageId)
  if (!message) return { ok: false, status: 'failed', error: 'Message not found' }
  if (message.direction !== 'outbound') return { ok: false, status: 'failed', error: 'Message is not outbound' }
  if (message.status !== 'queued' && message.status !== 'draft') {
    return { ok: false, status: 'failed', error: `Message is not sendable (status: ${message.status})` }
  }

  const conversation = await getConversation(orgId, message.conversationId)
  if (!conversation) return { ok: false, status: 'failed', error: 'Conversation not found' }

  const to = (conversation.contactSnapshot?.phone ?? '').trim()
  if (!to) return { ok: false, status: 'failed', error: 'Contact has no phone number to send to' }

  const provider = getCommunicationProviderForChannel(conversation.channel)
  if (!provider?.send) return { ok: false, status: 'failed', error: `No send provider for ${conversation.channel}` }

  // Prefer per-org credentials; platform env vars remain the fallback.
  const orgCredentials = await getOrgTwilioCredentials(orgId)
  const credentials = orgCredentials
    ? {
        accountSid: orgCredentials.accountSid,
        authToken: orgCredentials.authToken,
        messagingServiceSid: orgCredentials.messagingServiceSid,
        from: orgCredentials.whatsappFrom,
      }
    : undefined

  const base = platformBaseUrl()
  const statusCallbackUrl = base
    ? `${base}/api/v1/communications/webhooks/twilio?orgId=${encodeURIComponent(orgId)}`
    : undefined

  const result = await provider.send({
    orgId,
    channel: conversation.channel,
    to,
    body: message.body,
    mediaUrls: message.attachments?.map((attachment) => attachment.url),
    statusCallbackUrl,
    credentials,
    metadata: { conversationId: conversation.id, messageId },
  })

  const messageRef = adminDb.collection(COMMUNICATION_COLLECTIONS.messages).doc(messageId)
  if (result.ok && result.providerMessageId) {
    await messageRef.update({
      status: 'sent',
      providerMessageId: result.providerMessageId,
      'provider.id': provider.id,
      'provider.externalMessageId': result.providerMessageId,
      'provider.rawStatus': result.raw?.status ?? 'sent',
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    await recordCommunicationEvent(orgId, {
      type: 'message.sent',
      channel: conversation.channel,
      conversationId: conversation.id,
      messageId,
      contactId: conversation.contactId,
      campaignId: conversation.campaignId ?? null,
      payload: { providerMessageId: result.providerMessageId },
    })
    return { ok: true, status: 'sent', providerMessageId: result.providerMessageId }
  }

  const error = result.error ?? 'Provider failed to send the message'
  await messageRef.update({
    status: 'failed',
    failureReason: error,
    failedAt: FieldValue.serverTimestamp(),
    'provider.id': provider.id,
    'provider.rawStatus': result.status,
    updatedAt: FieldValue.serverTimestamp(),
  })
  await recordCommunicationEvent(orgId, {
    type: 'message.failed',
    channel: conversation.channel,
    conversationId: conversation.id,
    messageId,
    contactId: conversation.contactId,
    campaignId: conversation.campaignId ?? null,
    payload: { error },
  })
  return { ok: false, status: 'failed', error }
}

/**
 * Build an outbound auto-reply DRAFT from routing rules. Auto-replies never
 * send without human approval in V1 (spec §6 gate: no client-visible sends
 * without approval); the draft surfaces in the console for approval.
 */
export async function createPendingAutoReply(
  orgId: string,
  conversationId: string,
  body: string,
  reason: string,
): Promise<{ id: string; status: string }> {
  const conversation = await getConversation(orgId, conversationId)
  if (!conversation) throw new Error('Conversation not found')
  const result = await addConversationMessage(orgId, conversationId, {
    body,
    direction: 'outbound',
    status: 'queued',
    createdBy: 'system:routing',
    createdByType: 'system',
  })
  await recordCommunicationEvent(orgId, {
    type: 'message.queued',
    channel: conversation.channel,
    conversationId,
    messageId: result.id,
    contactId: conversation.contactId,
    campaignId: conversation.campaignId ?? null,
    payload: { autoReply: true, reason, approvalRequired: true },
  })
  return result
}
