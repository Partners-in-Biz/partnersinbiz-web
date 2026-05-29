import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildHermesConversationSuggestion } from './automation'
import { buildCommunicationAnalytics } from './analytics'
import {
  COMMUNICATION_CHANNELS,
  EMPTY_COMMUNICATION_CAMPAIGN_STATS,
  type AgentQueue,
  type CampaignStatus,
  type ChannelAccount,
  type CommunicationCampaign,
  type CommunicationChannel,
  type CommunicationEvent,
  type Conversation,
  type ConversationMessage,
  type ConversationPriority,
  type ConversationStatus,
  type MessageDirection,
  type MessageStatus,
  type MessageTemplate,
  type RoutingRule,
  type TemplateStatus,
} from './types'

export const COMMUNICATION_COLLECTIONS = {
  conversations: 'communication_conversations',
  messages: 'communication_messages',
  templates: 'communication_templates',
  campaigns: 'communication_campaigns',
  channels: 'communication_channels',
  automations: 'communication_automations',
  queues: 'communication_queues',
  routingRules: 'communication_routing_rules',
  events: 'communication_events',
} as const

export interface ConversationFilters {
  status?: ConversationStatus | null
  channel?: CommunicationChannel | null
  assignee?: 'unassigned' | 'mine' | string | null
  campaignId?: string | null
  queueId?: string | null
  priority?: ConversationPriority | null
  label?: string | null
  limit?: number
}

export interface CreateConversationInput {
  channel: CommunicationChannel
  contactId?: string | null
  body?: string
  subject?: string
  queueId?: string | null
  campaignId?: string | null
  labels?: string[]
  priority?: ConversationPriority
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
}

export interface AddConversationMessageInput {
  channel?: CommunicationChannel
  direction?: MessageDirection
  body: string
  status?: MessageStatus
  subject?: string
  templateId?: string | null
  campaignId?: string | null
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
}

export interface ListResult<T> {
  items: T[]
  total: number
}

export function isCommunicationChannel(value: unknown): value is CommunicationChannel {
  return typeof value === 'string' && COMMUNICATION_CHANNELS.includes(value as CommunicationChannel)
}

export async function listConversations(
  orgId: string,
  filters: ConversationFilters = {},
): Promise<ListResult<Conversation>> {
  const snap = await adminDb
    .collection(COMMUNICATION_COLLECTIONS.conversations)
    .where('orgId', '==', orgId)
    .get()

  const conversations = snap.docs
    .map((doc) => normalizeConversation(doc.id, doc.data()))
    .filter((conversation) => conversation.deleted !== true)
    .filter((conversation) => filterConversation(conversation, filters))
    .sort((a, b) => sortTimestampDesc(a.lastMessageAt ?? a.updatedAt ?? a.createdAt, b.lastMessageAt ?? b.updatedAt ?? b.createdAt))

  const limit = filters.limit ? Math.max(1, Math.min(500, filters.limit)) : 100
  return { items: conversations.slice(0, limit).map(serializeCommunicationValue) as Conversation[], total: conversations.length }
}

export async function createConversation(
  orgId: string,
  input: CreateConversationInput,
): Promise<{ id: string; orgId: string; status: ConversationStatus }> {
  if (!orgId) throw new Error('orgId is required')
  if (!isCommunicationChannel(input.channel)) throw new Error('channel is invalid')

  const contactSnapshot = input.contactId
    ? await loadContactSnapshot(orgId, input.contactId)
    : {}
  const ref = adminDb.collection(COMMUNICATION_COLLECTIONS.conversations).doc()
  const body = (input.body ?? '').trim()
  const labels = cleanStringArray(input.labels)
  const now = FieldValue.serverTimestamp()

  const conversation: Omit<Conversation, 'id'> & Record<string, unknown> = {
    orgId,
    channel: input.channel,
    status: body ? 'open' : 'new',
    priority: input.priority ?? 'normal',
    contactId: input.contactId ?? null,
    contactSnapshot,
    queueId: input.queueId ?? null,
    assigneeAgentId: null,
    assigneeUserId: null,
    labels,
    campaignId: input.campaignId ?? null,
    campaignReplySource: input.campaignId ? 'campaign' : null,
    subject: input.subject ?? '',
    lastMessagePreview: body ? body.slice(0, 160) : '',
    lastInboundMessageAt: body ? now : null,
    lastOutboundMessageAt: null,
    lastMessageAt: body ? now : null,
    snoozedUntil: null,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    createdByType: input.createdByType,
    deleted: false,
  }

  const batch = adminDb.batch()
  batch.set(ref, conversation)

  if (body) {
    const messageRef = adminDb.collection(COMMUNICATION_COLLECTIONS.messages).doc()
    batch.set(messageRef, {
      orgId,
      conversationId: ref.id,
      channel: input.channel,
      direction: 'inbound',
      body,
      status: 'received',
      subject: input.subject ?? '',
      contactId: input.contactId ?? null,
      campaignId: input.campaignId ?? null,
      createdBy: input.createdBy,
      createdByType: input.createdByType,
      createdAt: now,
      deleted: false,
    })
    batch.set(adminDb.collection(COMMUNICATION_COLLECTIONS.events).doc(), {
      orgId,
      type: 'message.received',
      channel: input.channel,
      contactId: input.contactId ?? null,
      conversationId: ref.id,
      messageId: messageRef.id,
      campaignId: input.campaignId ?? null,
      payload: { source: 'conversation_create' },
      createdAt: now,
    })
  }

  await batch.commit()
  return { id: ref.id, orgId, status: body ? 'open' : 'new' }
}

export async function getConversationBundle(orgId: string, conversationId: string) {
  const conversation = await getConversation(orgId, conversationId)
  if (!conversation) return null
  const messages = await listConversationMessages(orgId, conversationId)
  const contact = conversation.contactId ? await loadContactSnapshot(orgId, conversation.contactId) : null
  return {
    conversation,
    messages,
    contact,
    hermesSuggestion: buildHermesConversationSuggestion({
      conversation,
      messages,
      profile: contact?.profileExtensions ?? contact?.customFields ?? null,
    }),
  }
}

export async function getConversation(orgId: string, conversationId: string): Promise<Conversation | null> {
  const doc = await adminDb.collection(COMMUNICATION_COLLECTIONS.conversations).doc(conversationId).get()
  if (!doc.exists) return null
  const conversation = normalizeConversation(doc.id, doc.data() ?? {})
  if (conversation.orgId !== orgId || conversation.deleted === true) return null
  return serializeCommunicationValue(conversation) as Conversation
}

export async function updateConversation(
  orgId: string,
  conversationId: string,
  input: Partial<Pick<Conversation, 'status' | 'priority' | 'queueId' | 'assigneeAgentId' | 'assigneeUserId' | 'labels' | 'snoozedUntil'>>,
): Promise<Conversation | null> {
  const conversation = await getConversation(orgId, conversationId)
  if (!conversation) return null
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (input.status) update.status = input.status
  if (input.priority) update.priority = input.priority
  if (input.queueId !== undefined) update.queueId = input.queueId
  if (input.assigneeAgentId !== undefined) update.assigneeAgentId = input.assigneeAgentId
  if (input.assigneeUserId !== undefined) update.assigneeUserId = input.assigneeUserId
  if (input.labels) update.labels = cleanStringArray(input.labels)
  if (input.snoozedUntil !== undefined) update.snoozedUntil = input.snoozedUntil
  await adminDb.collection(COMMUNICATION_COLLECTIONS.conversations).doc(conversationId).update(update)
  return getConversation(orgId, conversationId)
}

export async function listConversationMessages(
  orgId: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const snap = await adminDb
    .collection(COMMUNICATION_COLLECTIONS.messages)
    .where('orgId', '==', orgId)
    .where('conversationId', '==', conversationId)
    .get()

  return snap.docs
    .map((doc) => normalizeMessage(doc.id, doc.data()))
    .filter((message) => (message as { deleted?: boolean }).deleted !== true)
    .sort((a, b) => sortTimestampAsc(a.createdAt, b.createdAt))
    .map(serializeCommunicationValue) as ConversationMessage[]
}

export async function addConversationMessage(
  orgId: string,
  conversationId: string,
  input: AddConversationMessageInput,
): Promise<{ id: string; status: MessageStatus }> {
  const conversation = await getConversation(orgId, conversationId)
  if (!conversation) throw new Error('conversation not found')
  const body = (input.body ?? '').trim()
  if (!body) throw new Error('body is required')
  const direction = input.direction ?? 'outbound'
  const status = input.status ?? (direction === 'outbound' ? 'draft' : 'received')
  const now = FieldValue.serverTimestamp()
  const messageRef = adminDb.collection(COMMUNICATION_COLLECTIONS.messages).doc()
  const batch = adminDb.batch()
  batch.set(messageRef, {
    orgId,
    conversationId,
    channel: input.channel ?? conversation.channel,
    direction,
    body,
    status,
    subject: input.subject ?? '',
    templateId: input.templateId ?? null,
    campaignId: input.campaignId ?? conversation.campaignId ?? null,
    contactId: conversation.contactId ?? null,
    createdBy: input.createdBy,
    createdByType: input.createdByType,
    createdAt: now,
    deleted: false,
  })
  batch.update(adminDb.collection(COMMUNICATION_COLLECTIONS.conversations).doc(conversationId), {
    status: direction === 'inbound' ? 'open' : conversation.status,
    lastMessagePreview: body.slice(0, 160),
    lastMessageAt: now,
    lastInboundMessageAt: direction === 'inbound' ? now : conversation.lastInboundMessageAt ?? null,
    lastOutboundMessageAt: direction === 'outbound' ? now : conversation.lastOutboundMessageAt ?? null,
    updatedAt: now,
  })
  batch.set(adminDb.collection(COMMUNICATION_COLLECTIONS.events).doc(), {
    orgId,
    type: direction === 'inbound' ? 'message.received' : 'message.queued',
    channel: input.channel ?? conversation.channel,
    contactId: conversation.contactId ?? null,
    conversationId,
    messageId: messageRef.id,
    campaignId: input.campaignId ?? conversation.campaignId ?? null,
    payload: { status },
    createdAt: now,
  })
  await batch.commit()
  return { id: messageRef.id, status }
}

export async function listTemplates(orgId: string, channel?: CommunicationChannel | null): Promise<ListResult<MessageTemplate>> {
  const items = await listCollection<MessageTemplate>(COMMUNICATION_COLLECTIONS.templates, orgId)
  const filtered = channel ? items.filter((item) => item.channel === channel) : items
  return { items: filtered, total: filtered.length }
}

export async function createTemplate(
  orgId: string,
  input: Partial<MessageTemplate> & Pick<MessageTemplate, 'name' | 'channel' | 'content'>,
): Promise<{ id: string; orgId: string; status: TemplateStatus }> {
  if (!input.name?.trim()) throw new Error('name is required')
  if (!isCommunicationChannel(input.channel)) throw new Error('channel is invalid')
  const ref = await adminDb.collection(COMMUNICATION_COLLECTIONS.templates).add({
    orgId,
    name: input.name.trim(),
    channel: input.channel,
    status: input.status ?? 'draft',
    category: input.category ?? null,
    content: input.content,
    variables: cleanStringArray(input.variables),
    provider: input.provider ?? { id: input.channel === 'email' ? 'resend' : input.channel === 'in_app' ? 'in_app' : 'twilio' },
    description: input.description ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })
  return { id: ref.id, orgId, status: input.status ?? 'draft' }
}

export async function listCampaigns(orgId: string, channel?: CommunicationChannel | null): Promise<ListResult<CommunicationCampaign>> {
  const items = await listCollection<CommunicationCampaign>(COMMUNICATION_COLLECTIONS.campaigns, orgId)
  const filtered = channel ? items.filter((item) => item.channel === channel) : items
  return { items: filtered, total: filtered.length }
}

export async function createCampaign(
  orgId: string,
  input: Partial<CommunicationCampaign> & Pick<CommunicationCampaign, 'name' | 'channel' | 'templateId'>,
): Promise<{ id: string; orgId: string; status: CampaignStatus }> {
  if (!input.name?.trim()) throw new Error('name is required')
  if (!isCommunicationChannel(input.channel)) throw new Error('channel is invalid')
  const status: CampaignStatus = input.status ?? 'draft'
  const ref = await adminDb.collection(COMMUNICATION_COLLECTIONS.campaigns).add({
    orgId,
    name: input.name.trim(),
    channel: input.channel,
    status,
    templateId: input.templateId,
    audience: input.audience ?? { segmentId: null, contactIds: [], tags: [] },
    variableMap: input.variableMap ?? {},
    replyRouting: input.replyRouting ?? {},
    scheduledFor: input.scheduledFor ?? null,
    stats: input.stats ?? { ...EMPTY_COMMUNICATION_CAMPAIGN_STATS },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })
  return { id: ref.id, orgId, status }
}

export async function listChannelAccounts(orgId: string): Promise<ListResult<ChannelAccount>> {
  const items = await listCollection<ChannelAccount>(COMMUNICATION_COLLECTIONS.channels, orgId)
  return { items, total: items.length }
}

export async function listQueues(orgId: string): Promise<ListResult<AgentQueue>> {
  const items = await listCollection<AgentQueue>(COMMUNICATION_COLLECTIONS.queues, orgId)
  return { items, total: items.length }
}

export async function listRoutingRules(orgId: string): Promise<ListResult<RoutingRule>> {
  const items = await listCollection<RoutingRule>(COMMUNICATION_COLLECTIONS.routingRules, orgId)
  return { items, total: items.length }
}

export async function listAutomations(orgId: string): Promise<ListResult<RoutingRule>> {
  return listRoutingRules(orgId)
}

export async function createAutomation(
  orgId: string,
  input: Partial<RoutingRule> & Pick<RoutingRule, 'name'>,
): Promise<{ id: string; orgId: string; status: string }> {
  const ref = await adminDb.collection(COMMUNICATION_COLLECTIONS.routingRules).add({
    orgId,
    name: input.name.trim(),
    status: input.status ?? 'draft',
    priority: input.priority ?? 100,
    channels: input.channels ?? COMMUNICATION_CHANNELS,
    conditions: input.conditions ?? [],
    actions: input.actions ?? [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })
  return { id: ref.id, orgId, status: input.status ?? 'draft' }
}

export async function listEvents(orgId: string, limit = 500): Promise<ListResult<CommunicationEvent>> {
  const items = await listCollection<CommunicationEvent>(COMMUNICATION_COLLECTIONS.events, orgId)
  const sorted = items.sort((a, b) => sortTimestampDesc(a.createdAt, b.createdAt)).slice(0, limit)
  return { items: sorted, total: items.length }
}

export async function getCommunicationAnalytics(orgId: string) {
  const [conversations, campaigns, events] = await Promise.all([
    listConversations(orgId, { limit: 500 }),
    listCampaigns(orgId),
    listEvents(orgId, 1000),
  ])
  return buildCommunicationAnalytics({
    conversations: conversations.items,
    campaigns: campaigns.items,
    events: events.items,
  })
}

async function listCollection<T>(collection: string, orgId: string): Promise<T[]> {
  const snap = await adminDb.collection(collection).where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => (item as { deleted?: boolean }).deleted !== true)
    .sort((a, b) => sortTimestampDesc((a as { updatedAt?: unknown }).updatedAt ?? (a as { createdAt?: unknown }).createdAt, (b as { updatedAt?: unknown }).updatedAt ?? (b as { createdAt?: unknown }).createdAt))
    .map(serializeCommunicationValue) as T[]
}

function filterConversation(conversation: Conversation, filters: ConversationFilters): boolean {
  if (filters.status && conversation.status !== filters.status) return false
  if (filters.channel && conversation.channel !== filters.channel) return false
  if (filters.campaignId && conversation.campaignId !== filters.campaignId) return false
  if (filters.queueId && conversation.queueId !== filters.queueId) return false
  if (filters.priority && conversation.priority !== filters.priority) return false
  if (filters.label && !(conversation.labels ?? []).includes(filters.label)) return false
  if (filters.assignee === 'unassigned') {
    return !conversation.assigneeAgentId && !conversation.assigneeUserId
  }
  if (filters.assignee && filters.assignee !== 'mine') {
    return conversation.assigneeAgentId === filters.assignee || conversation.assigneeUserId === filters.assignee
  }
  return true
}

function normalizeConversation(id: string, data: FirebaseFirestore.DocumentData): Conversation {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    channel: isCommunicationChannel(data.channel) ? data.channel : 'whatsapp',
    status: isConversationStatus(data.status) ? data.status : 'open',
    priority: isPriority(data.priority) ? data.priority : 'normal',
    contactId: typeof data.contactId === 'string' && data.contactId ? data.contactId : null,
    contactSnapshot: data.contactSnapshot && typeof data.contactSnapshot === 'object' ? data.contactSnapshot : {},
    queueId: typeof data.queueId === 'string' && data.queueId ? data.queueId : null,
    assigneeAgentId: typeof data.assigneeAgentId === 'string' && data.assigneeAgentId ? data.assigneeAgentId : null,
    assigneeUserId: typeof data.assigneeUserId === 'string' && data.assigneeUserId ? data.assigneeUserId : null,
    labels: cleanStringArray(data.labels),
    campaignId: typeof data.campaignId === 'string' && data.campaignId ? data.campaignId : null,
    campaignReplySource: typeof data.campaignReplySource === 'string' ? data.campaignReplySource : null,
    subject: typeof data.subject === 'string' ? data.subject : '',
    lastMessagePreview: typeof data.lastMessagePreview === 'string' ? data.lastMessagePreview : '',
    lastInboundMessageAt: data.lastInboundMessageAt ?? null,
    lastOutboundMessageAt: data.lastOutboundMessageAt ?? null,
    lastMessageAt: data.lastMessageAt ?? null,
    snoozedUntil: data.snoozedUntil ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    deleted: data.deleted === true,
  }
}

function normalizeMessage(id: string, data: FirebaseFirestore.DocumentData): ConversationMessage {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    conversationId: String(data.conversationId ?? ''),
    channel: isCommunicationChannel(data.channel) ? data.channel : 'whatsapp',
    direction: data.direction === 'outbound' ? 'outbound' : 'inbound',
    body: typeof data.body === 'string' ? data.body : '',
    status: isMessageStatus(data.status) ? data.status : 'received',
    subject: typeof data.subject === 'string' ? data.subject : '',
    templateId: typeof data.templateId === 'string' ? data.templateId : null,
    campaignId: typeof data.campaignId === 'string' ? data.campaignId : null,
    contactId: typeof data.contactId === 'string' ? data.contactId : null,
    provider: data.provider && typeof data.provider === 'object' ? data.provider : undefined,
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : null,
    createdByType: data.createdByType === 'agent' || data.createdByType === 'system' ? data.createdByType : 'user',
    createdAt: data.createdAt ?? null,
    deliveredAt: data.deliveredAt ?? null,
    readAt: data.readAt ?? null,
    failedAt: data.failedAt ?? null,
  }
}

async function loadContactSnapshot(orgId: string, contactId: string) {
  try {
    const doc = await adminDb.collection('contacts').doc(contactId).get()
    if (!doc.exists) return { id: contactId }
    const data = doc.data() ?? {}
    if (data.orgId && data.orgId !== orgId) return { id: contactId }
    return {
      id: contactId,
      name: data.name ?? data.fullName ?? '',
      firstName: data.firstName ?? splitName(data.name).firstName,
      lastName: data.lastName ?? splitName(data.name).lastName,
      email: data.email ?? '',
      phone: data.phone ?? '',
      company: data.company ?? data.companyName ?? '',
      tier: data.tier ?? data.loyaltyTier ?? '',
      pointsBalance: data.pointsBalance ?? data.loyaltyPoints ?? '',
      tags: cleanStringArray(data.tags),
      labels: cleanStringArray(data.labels),
      customFields: data.customFields ?? {},
      preferences: {
        subscribedAt: data.subscribedAt ?? null,
        unsubscribedAt: data.unsubscribedAt ?? null,
        smsOptedIn: data.smsOptedIn ?? null,
        smsUnsubscribedAt: data.smsUnsubscribedAt ?? null,
      },
      profileExtensions: data.profileExtensions ?? data.loyaltyProfile ?? {},
    }
  } catch {
    return { id: contactId }
  }
}

function splitName(name: unknown): { firstName: string; lastName: string } {
  if (typeof name !== 'string') return { firstName: '', lastName: '' }
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
}

function isConversationStatus(value: unknown): value is ConversationStatus {
  return typeof value === 'string' && ['new', 'open', 'pending', 'resolved', 'snoozed'].includes(value)
}

function isPriority(value: unknown): value is ConversationPriority {
  return typeof value === 'string' && ['low', 'normal', 'high', 'urgent'].includes(value)
}

function isMessageStatus(value: unknown): value is MessageStatus {
  return typeof value === 'string' && ['draft', 'queued', 'sent', 'delivered', 'read', 'failed', 'received'].includes(value)
}

function sortTimestampDesc(a: unknown, b: unknown): number {
  return toMillis(b) - toMillis(a)
}

function sortTimestampAsc(a: unknown, b: unknown): number {
  return toMillis(a) - toMillis(b)
}

function toMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value === 'number') return value
  if (typeof value === 'object') {
    const source = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof source.toMillis === 'function') {
      try {
        return source.toMillis()
      } catch {
        return 0
      }
    }
    if (typeof source.toDate === 'function') {
      try {
        return source.toDate().getTime()
      } catch {
        return 0
      }
    }
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

export function serializeCommunicationValue<T>(value: T): T {
  if (!value) return value
  if (value instanceof Date) return value.toISOString() as T
  if (Array.isArray(value)) return value.map(serializeCommunicationValue) as T
  if (typeof value === 'object') {
    const source = value as Record<string, unknown> & { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof source.toDate === 'function') {
      try {
        return source.toDate().toISOString() as T
      } catch {
        return null as T
      }
    }
    if (typeof source.seconds === 'number' || typeof source._seconds === 'number') {
      const seconds = source.seconds ?? source._seconds ?? 0
      return new Date(seconds * 1000).toISOString() as T
    }
    return Object.fromEntries(
      Object.entries(source).map(([key, item]) => [key, serializeCommunicationValue(item)]),
    ) as T
  }
  return value
}
