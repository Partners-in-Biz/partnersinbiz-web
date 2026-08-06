/**
 * Inbound webhook processing for the communications module (Workstream 1).
 *
 * Handles Twilio WhatsApp/SMS inbound callbacks and outbound status callbacks:
 *   1. Resolve the owning org (query orgId → webhook route by sender → platform
 *      fallback for the platform's own env-var account).
 *   2. Ingest inbound messages into conversations with idempotency.
 *   3. Run the classifier + routing rules (assign_queue, assign_agent,
 *      add_label, set_priority, send_auto_reply, create_task,
 *      request_hermes_suggestion).
 *   4. Apply outbound status callbacks (delivered/read/failed) per org.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { classifyInboundMessage, shouldAutoReplyAfterHours, type InboundClassification } from './automation'
import { normalizePhoneKey } from './credentials'
import { createPendingAutoReply } from './send'
import {
  addConversationMessage,
  createConversation,
  getConversation,
  getOrgTwilioCredentials,
  getWebhookRouteBySender,
  listRoutingRules,
  recordCommunicationEvent,
  updateConversation,
  COMMUNICATION_COLLECTIONS,
} from './store'
import type { ChannelAccount, CommunicationChannel, Conversation, RoutingRule } from './types'

export interface TwilioWebhookParams {
  [key: string]: string
}

export interface ParsedInboundMessage {
  from: string
  to: string
  body: string
  messageSid: string
  numMedia: number
  mediaUrls: string[]
  profileName: string
  waId: string
}

export interface ResolvedWebhookOrg {
  orgId: string
  source: 'query' | 'route' | 'platform'
}

/** Parse Twilio's application/x-www-form-urlencoded webhook payload. */
export function parseTwilioFormParams(rawBody: string): TwilioWebhookParams {
  const params: TwilioWebhookParams = {}
  for (const [key, value] of new URLSearchParams(rawBody).entries()) {
    params[key] = value
  }
  return params
}

export function isStatusCallback(params: TwilioWebhookParams): boolean {
  return Boolean(params.MessageStatus || params.SmsStatus)
}

export function parseInboundMessage(params: TwilioWebhookParams): ParsedInboundMessage {
  const numMedia = Math.max(0, Number(params.NumMedia ?? 0) || 0)
  const mediaUrls: string[] = []
  for (let index = 0; index < numMedia; index += 1) {
    const url = params[`MediaUrl${index}`]
    if (url) mediaUrls.push(url)
  }
  return {
    from: (params.From ?? '').trim(),
    to: (params.To ?? '').trim(),
    body: (params.Body ?? '').trim(),
    messageSid: (params.MessageSid ?? params.SmsMessageSid ?? '').trim(),
    numMedia,
    mediaUrls,
    profileName: (params.ProfileName ?? '').trim(),
    waId: (params.WaId ?? '').trim(),
  }
}

/**
 * Resolve the org that owns this webhook. Query orgId wins (we generate
 * per-org statusCallback URLs), then the sender route mapping, then the
 * platform's own env-var account.
 */
export async function resolveWebhookOrg(
  queryOrgId: string | null,
  to: string,
): Promise<ResolvedWebhookOrg | null> {
  if (queryOrgId) return { orgId: queryOrgId, source: 'query' }
  const route = await getWebhookRouteBySender(to)
  if (route?.orgId) return { orgId: route.orgId, source: 'route' }
  const platformFrom = (process.env.TWILIO_WHATSAPP_FROM ?? '').trim()
  if (platformFrom && normalizePhoneKey(platformFrom) === normalizePhoneKey(to)) {
    return { orgId: PIB_PLATFORM_ORG_ID, source: 'platform' }
  }
  return null
}

/** Resolve the auth token used to verify a Twilio signature for an org. */
export async function resolveValidationAuthToken(orgId: string): Promise<string | null> {
  const stored = await getOrgTwilioCredentials(orgId)
  if (stored?.authToken) return stored.authToken
  return (process.env.TWILIO_AUTH_TOKEN ?? '').trim() || null
}

export interface IngestInboundResult {
  conversation: Conversation
  conversationCreated: boolean
  messageId: string
  duplicate: boolean
  classification: InboundClassification
  routing: RoutingAppliedSummary
}

export interface RoutingAppliedSummary {
  ruleMatched: boolean
  ruleId?: string
  ruleName?: string
  actionsApplied: string[]
}

/**
 * Create or update a conversation for an inbound WhatsApp/SMS message and run
 * the classifier + routing pipeline. Idempotent per provider message SID.
 */
export async function ingestInboundMessage(
  orgId: string,
  inbound: ParsedInboundMessage,
  opts: { channelAccount?: ChannelAccount | null } = {},
): Promise<IngestInboundResult> {
  const channel: CommunicationChannel = inbound.from.startsWith('whatsapp:') || inbound.to.startsWith('whatsapp:')
    ? 'whatsapp'
    : 'sms'
  const phone = inbound.from.replace(/^(whatsapp|sms):/i, '')
  const inboundKey = `${channel}:${normalizePhoneKey(inbound.from)}`
  const classification = classifyInboundMessage(inbound.body, channel)

  // Idempotency: same provider SID must not create duplicate messages.
  const existingBySid = inbound.messageSid
    ? await adminDb.collection(COMMUNICATION_COLLECTIONS.messages).where('providerMessageId', '==', inbound.messageSid).limit(5).get()
    : null
  if (existingBySid && !existingBySid.empty) {
    for (const doc of existingBySid.docs) {
      const data = doc.data() ?? {}
      if (String(data.orgId ?? '') === orgId && data.deleted !== true) {
        const conversation = await getConversation(orgId, String(data.conversationId ?? ''))
        if (conversation) {
          return {
            conversation,
            conversationCreated: false,
            messageId: doc.id,
            duplicate: true,
            classification,
            routing: { ruleMatched: false, actionsApplied: [] },
          }
        }
      }
    }
  }

  // Find an existing thread for this sender, else create one.
  const existingSnap = await adminDb
    .collection(COMMUNICATION_COLLECTIONS.conversations)
    .where('inboundKey', '==', inboundKey)
    .limit(10)
    .get()
  let conversation: Conversation | null = null
  let conversationCreated = false
  for (const doc of existingSnap.docs) {
    const data = doc.data() ?? {}
    if (String(data.orgId ?? '') === orgId && data.deleted !== true) {
      conversation = await getConversation(orgId, doc.id)
      if (conversation) break
    }
  }

  if (!conversation) {
    const created = await createConversation(orgId, {
      channel,
      body: '',
      createdBy: 'system:twilio-webhook',
      createdByType: 'system',
      inboundKey,
      contactSnapshot: {
        name: inbound.profileName || undefined,
        phone,
        customFields: inbound.waId ? { waId: inbound.waId } : {},
      },
      labels: [],
    })
    conversation = await getConversation(orgId, created.id)
    conversationCreated = true
  }

  if (!conversation) throw new Error('Failed to create inbound conversation')

  const messageResult = await addConversationMessage(orgId, conversation.id, {
    channel,
    direction: 'inbound',
    body: inbound.body,
    status: 'received',
    createdBy: 'system:twilio-webhook',
    createdByType: 'system',
    provider: { id: 'twilio', externalMessageId: inbound.messageSid || null, rawStatus: 'received' },
    providerMessageId: inbound.messageSid || undefined,
    attachments: inbound.mediaUrls.map((url) => ({ type: 'image', url })),
  })

  const routing = await applyInboundRouting(orgId, {
    conversation,
    messageId: messageResult.id,
    body: inbound.body,
    channel,
    classification,
    channelAccount: opts.channelAccount ?? null,
  })

  await recordCommunicationEvent(orgId, {
    type: 'webhook.received',
    channel,
    conversationId: conversation.id,
    messageId: messageResult.id,
    payload: {
      intent: classification.intent,
      confidence: classification.confidence,
      provider: 'twilio',
      from: inbound.from,
      ruleMatched: routing.ruleMatched,
      ruleName: routing.ruleName ?? null,
    },
  })

  return { conversation, conversationCreated, messageId: messageResult.id, duplicate: false, classification, routing }
}

export interface ApplyRoutingInput {
  conversation: Conversation
  messageId: string
  body: string
  channel: CommunicationChannel
  classification: InboundClassification
  channelAccount?: ChannelAccount | null
}

/** Run active routing rules and classification defaults against a conversation. */
export async function applyInboundRouting(
  orgId: string,
  input: ApplyRoutingInput,
): Promise<RoutingAppliedSummary> {
  const { conversation, messageId, body, channel, classification, channelAccount } = input
  const actionsApplied: string[] = []

  const rules = (await listRoutingRules(orgId)).items
    .filter((rule) => rule.status === 'active' && (rule.channels ?? []).includes(channel))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))

  let matchedRule: RoutingRule | null = null
  for (const rule of rules) {
    if (ruleMatches(rule, { conversation, body, channel, classification, channelAccount })) {
      matchedRule = rule
      break
    }
  }

  if (matchedRule) {
    for (const action of matchedRule.actions ?? []) {
      const applied = await applyRoutingAction(orgId, {
        conversation,
        messageId,
        body,
        channel,
        classification,
        actionType: action.type,
        actionValue: action.value,
      })
      if (applied) actionsApplied.push(`${action.type}${action.value ? `:${action.value}` : ''}`)
    }
  }

  // Classification defaults when no rule handled them.
  if (!matchedRule || !actionsApplied.some((action) => action.startsWith('set_priority'))) {
    if (classification.priority === 'urgent' && conversation.priority !== 'urgent') {
      await updateConversation(orgId, conversation.id, { priority: 'urgent' })
      actionsApplied.push('set_priority:urgent')
    }
  }
  if (classification.intent === 'opt_out') {
    const labels = Array.from(new Set([...(conversation.labels ?? []), 'compliance']))
    await updateConversation(orgId, conversation.id, { labels })
    await recordCommunicationEvent(orgId, {
      type: 'opt_out.recorded',
      channel,
      conversationId: conversation.id,
      messageId,
      contactId: conversation.contactId,
      payload: { source: 'classify_inbound', from: conversation.contactSnapshot.phone ?? null },
    })
    actionsApplied.push('add_label:compliance')
  }
  if (classification.intent === 'opt_out' || classification.intent === 'help_request') {
    if (classification.recommendedActions.includes('mark_conversation_resolved') && conversation.status !== 'resolved') {
      await updateConversation(orgId, conversation.id, { status: 'resolved' })
      actionsApplied.push('status:resolved')
    }
  }

  return {
    ruleMatched: Boolean(matchedRule),
    ruleId: matchedRule?.id,
    ruleName: matchedRule?.name,
    actionsApplied,
  }
}

function ruleMatches(
  rule: RoutingRule,
  context: {
    conversation: Conversation
    body: string
    channel: CommunicationChannel
    classification: InboundClassification
    channelAccount?: ChannelAccount | null
  },
): boolean {
  const { conversation, body, channel, channelAccount } = context
  for (const condition of rule.conditions ?? []) {
    const value = condition.value
    if (condition.field === 'body') {
      const haystack = body.toLowerCase()
      if (condition.operator === 'contains' && (!value || !haystack.includes(String(value).toLowerCase()))) return false
      if (condition.operator === 'equals' && haystack !== String(value ?? '').toLowerCase()) return false
      if (condition.operator === 'exists' && !body) return false
    } else if (condition.field === 'channel') {
      if (condition.operator === 'equals' && channel !== value) return false
      if (condition.operator === 'in' && Array.isArray(value) && !value.includes(channel)) return false
    } else if (condition.field === 'campaignId') {
      if (condition.operator === 'exists') {
        if (!conversation.campaignId) return false
      } else if (conversation.campaignId !== value) {
        return false
      }
    } else if (condition.field === 'label') {
      const labels = conversation.labels ?? []
      if (condition.operator === 'exists') {
        if (!value || !labels.includes(String(value))) return false
      } else if (condition.operator === 'in') {
        const values = Array.isArray(value) ? value.map(String) : []
        if (!values.some((item) => labels.includes(item))) return false
      } else if (!labels.includes(String(value))) {
        return false
      }
    } else if (condition.field === 'contactTag') {
      const tags = conversation.contactSnapshot?.tags ?? []
      const values = Array.isArray(value) ? value.map(String) : [String(value)]
      if (!values.some((item) => tags.includes(item))) return false
    } else if (condition.field === 'afterHours') {
      const shouldAuto = channelAccount?.businessHours
        ? shouldAutoReplyAfterHours({
            now: new Date(),
            timezone: channelAccount.businessHours.timezone,
            businessHours: channelAccount.businessHours,
          })
        : false
      if (condition.operator === 'equals' && shouldAuto !== Boolean(value)) return false
      if (condition.operator === 'exists' && !shouldAuto) return false
    }
  }
  return true
}

async function applyRoutingAction(
  orgId: string,
  input: {
    conversation: Conversation
    messageId: string
    body: string
    channel: CommunicationChannel
    classification: InboundClassification
    actionType: RoutingRule['actions'][number]['type']
    actionValue?: string
  },
): Promise<boolean> {
  const { conversation, messageId, actionType, actionValue } = input
  const id = conversation.id

  switch (actionType) {
    case 'assign_queue': {
      if (!actionValue) return false
      await updateConversation(orgId, id, { queueId: actionValue })
      await recordCommunicationEvent(orgId, {
        type: 'conversation.assigned',
        channel: input.channel,
        conversationId: id,
        messageId,
        contactId: conversation.contactId,
        payload: { queueId: actionValue, source: 'routing_rule' },
      })
      return true
    }
    case 'assign_agent': {
      if (!actionValue) return false
      await updateConversation(orgId, id, { assigneeAgentId: actionValue })
      await recordCommunicationEvent(orgId, {
        type: 'conversation.assigned',
        channel: input.channel,
        conversationId: id,
        messageId,
        contactId: conversation.contactId,
        payload: { assigneeAgentId: actionValue, source: 'routing_rule' },
      })
      return true
    }
    case 'add_label': {
      if (!actionValue) return false
      const labels = Array.from(new Set([...(conversation.labels ?? []), actionValue]))
      await updateConversation(orgId, id, { labels })
      return true
    }
    case 'set_priority': {
      const priority = actionValue && ['low', 'normal', 'high', 'urgent'].includes(actionValue)
        ? (actionValue as Conversation['priority'])
        : null
      if (!priority) return false
      await updateConversation(orgId, id, { priority })
      return true
    }
    case 'send_auto_reply': {
      // V1 gate: auto-replies become approval-pending drafts, never auto-send.
      if (!actionValue) return false
      await createPendingAutoReply(orgId, id, actionValue, 'routing_rule:send_auto_reply')
      return true
    }
    case 'create_task': {
      const title = actionValue?.trim() || `Follow up on WhatsApp conversation with ${conversation.contactSnapshot?.name || conversation.contactSnapshot?.phone || 'contact'}`
      await adminDb.collection('tasks').doc().set({
        orgId,
        title,
        status: 'pending',
        priority: conversation.priority,
        assignedTo: null,
        queueId: conversation.queueId,
        contactId: conversation.contactId ?? null,
        source: 'communications_whatsapp',
        sourceId: messageId,
        conversationId: id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        deleted: false,
      })
      return true
    }
    case 'request_hermes_suggestion': {
      await recordCommunicationEvent(orgId, {
        type: 'hermes.suggestion_created',
        channel: input.channel,
        conversationId: id,
        messageId,
        contactId: conversation.contactId,
        payload: { mode: 'internal_copilot', source: 'routing_rule' },
      })
      return true
    }
    default:
      return false
  }
}
