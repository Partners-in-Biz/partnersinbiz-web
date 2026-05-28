export const COMMUNICATION_CHANNELS = [
  'whatsapp',
  'sms',
  'email',
  'in_app',
  'messenger',
  'instagram',
] as const

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number]

export type ConversationStatus = 'new' | 'open' | 'pending' | 'resolved' | 'snoozed'
export type ConversationPriority = 'low' | 'normal' | 'high' | 'urgent'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageStatus =
  | 'draft'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'received'
export type TemplateStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'archived'
export type WhatsAppTemplateCategory = 'utility' | 'marketing' | 'authentication'
export type CommunicationProviderId = 'twilio' | 'resend' | 'ses' | 'in_app' | 'meta' | 'manual'
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled' | 'failed'
export type RoutingRuleStatus = 'active' | 'paused' | 'draft'
export type ChannelAccountStatus = 'disabled' | 'needs_setup' | 'ready' | 'degraded' | 'suspended'
export type CommunicationEventType =
  | 'message.queued'
  | 'message.sent'
  | 'message.delivered'
  | 'message.read'
  | 'message.failed'
  | 'message.received'
  | 'reply.received'
  | 'opt_out.recorded'
  | 'campaign.clicked'
  | 'conversation.assigned'
  | 'conversation.resolved'
  | 'hermes.suggestion_created'

export interface CommunicationContactSnapshot {
  id?: string
  name?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  company?: string
  tier?: string
  pointsBalance?: number | string
  tags?: string[]
  labels?: string[]
  customFields?: Record<string, unknown>
  preferences?: Record<string, unknown>
  profileExtensions?: Record<string, unknown>
}

export interface Conversation {
  id: string
  orgId: string
  channel: CommunicationChannel
  status: ConversationStatus
  priority: ConversationPriority
  contactId: string | null
  contactSnapshot: CommunicationContactSnapshot
  queueId: string | null
  assigneeAgentId: string | null
  assigneeUserId: string | null
  labels: string[]
  campaignId: string | null
  campaignReplySource?: string | null
  subject?: string
  lastMessagePreview?: string
  lastInboundMessageAt?: unknown
  lastOutboundMessageAt?: unknown
  lastMessageAt: unknown
  snoozedUntil: unknown
  createdAt: unknown
  updatedAt: unknown
  deleted?: boolean
}

export interface ConversationMessage {
  id: string
  orgId: string
  conversationId: string
  channel: CommunicationChannel
  direction: MessageDirection
  body: string
  status: MessageStatus
  subject?: string
  templateId?: string | null
  campaignId?: string | null
  contactId?: string | null
  provider?: {
    id: CommunicationProviderId
    externalMessageId?: string | null
    rawStatus?: string | null
    costUsd?: number | null
  }
  attachments?: Array<{
    type: 'image' | 'file' | 'audio' | 'video'
    url: string
    name?: string
  }>
  createdBy?: string | null
  createdByType?: 'user' | 'agent' | 'system'
  createdAt: unknown
  deliveredAt?: unknown
  readAt?: unknown
  failedAt?: unknown
}

export interface MessageTemplateContent {
  subject?: string
  preheader?: string
  header?: string
  body: string
  html?: string
  footer?: string
  buttons?: Array<{
    type: 'quick_reply' | 'url' | 'phone' | 'postback'
    label: string
    value?: string
  }>
  media?: Array<{
    type: 'image' | 'file'
    url: string
    alt?: string
  }>
  cards?: Array<{
    title: string
    subtitle?: string
    imageUrl?: string
    buttons?: MessageTemplateContent['buttons']
  }>
}

export interface MessageTemplate {
  id: string
  orgId: string
  name: string
  channel: CommunicationChannel
  status: TemplateStatus
  category?: WhatsAppTemplateCategory
  content: MessageTemplateContent
  variables: string[]
  provider: {
    id: CommunicationProviderId
    externalTemplateId?: string | null
    approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected' | null
    lastSyncedAt?: unknown
  }
  description?: string
  createdAt: unknown
  updatedAt: unknown
  deleted?: boolean
}

export interface CommunicationCampaignStats {
  sent: number
  delivered: number
  read: number
  replies: number
  clicks: number
  optOuts: number
  failed: number
  costUsd: number
}

export interface CommunicationCampaign {
  id: string
  orgId: string
  name: string
  channel: CommunicationChannel
  status: CampaignStatus
  templateId: string
  audience: {
    segmentId?: string | null
    contactIds: string[]
    tags: string[]
    filters?: Record<string, unknown>
  }
  variableMap: Record<string, string>
  replyRouting: {
    queueId?: string | null
    assigneeAgentId?: string | null
    assigneeUserId?: string | null
  }
  scheduledFor: unknown
  stats: CommunicationCampaignStats
  createdAt: unknown
  updatedAt: unknown
  deleted?: boolean
}

export interface ChannelAccount {
  id: string
  orgId: string
  channel: CommunicationChannel
  providerId: CommunicationProviderId
  status: ChannelAccountStatus
  displayName: string
  senderId?: string
  phoneNumber?: string
  externalAccountId?: string
  readiness: {
    configured: boolean
    healthy: boolean
    missing: string[]
    checks: Array<{
      id: string
      label: string
      status: 'pass' | 'warn' | 'fail'
      detail?: string
    }>
  }
  quotas?: {
    dailyLimit?: number
    dailyUsed?: number
    monthlyLimit?: number
    monthlyUsed?: number
  }
  businessHours?: {
    timezone: string
    daysOfWeek: number[]
    startHourLocal: number
    endHourLocal: number
  }
  createdAt: unknown
  updatedAt: unknown
  deleted?: boolean
}

export interface RoutingRule {
  id: string
  orgId: string
  name: string
  status: RoutingRuleStatus
  priority: number
  channels: CommunicationChannel[]
  conditions: Array<{
    field: 'body' | 'channel' | 'campaignId' | 'label' | 'contactTag' | 'afterHours'
    operator: 'contains' | 'equals' | 'in' | 'exists'
    value?: string | string[] | boolean
  }>
  actions: Array<{
    type:
      | 'assign_queue'
      | 'assign_agent'
      | 'add_label'
      | 'set_priority'
      | 'send_auto_reply'
      | 'create_task'
      | 'request_hermes_suggestion'
    value?: string
  }>
  createdAt: unknown
  updatedAt: unknown
  deleted?: boolean
}

export interface AgentQueue {
  id: string
  orgId: string
  name: string
  description?: string
  channels: CommunicationChannel[]
  agentIds: string[]
  userIds: string[]
  defaultPriority: ConversationPriority
  businessHours?: ChannelAccount['businessHours']
  createdAt: unknown
  updatedAt: unknown
  deleted?: boolean
}

export interface CommunicationEvent {
  id: string
  orgId: string
  type: CommunicationEventType
  channel: CommunicationChannel
  contactId?: string | null
  conversationId?: string | null
  messageId?: string | null
  campaignId?: string | null
  payload: Record<string, unknown>
  createdAt: unknown
}

export interface HermesCommunicationSuggestion {
  mode: 'internal_copilot'
  directSendAllowed: false
  summary: string
  detectedIntent: string
  recommendedOwnerAgentId: 'pip' | 'maya' | 'nora' | 'sage' | 'theo'
  recommendedPriority: ConversationPriority
  recommendedLabels: string[]
  draftReply: string
  recommendedActions: string[]
}

export const EMPTY_COMMUNICATION_CAMPAIGN_STATS: CommunicationCampaignStats = {
  sent: 0,
  delivered: 0,
  read: 0,
  replies: 0,
  clicks: 0,
  optOuts: 0,
  failed: 0,
  costUsd: 0,
}
