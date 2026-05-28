import type {
  CommunicationChannel,
  Conversation,
  ConversationMessage,
  ConversationPriority,
  HermesCommunicationSuggestion,
} from './types'

export interface InboundClassification {
  intent:
    | 'opt_out'
    | 'opt_in'
    | 'help_request'
    | 'balance_request'
    | 'urgent_support'
    | 'general_reply'
  channel: CommunicationChannel
  confidence: number
  priority: ConversationPriority
  recommendedActions: string[]
}

export function classifyInboundMessage(
  body: string,
  channel: CommunicationChannel,
): InboundClassification {
  const text = (body ?? '').trim()
  const normalised = text.toLowerCase()
  const firstToken = normalised.split(/\s+/)[0] ?? ''

  if (['stop', 'stopall', 'unsubscribe', 'cancel', 'quit', 'end'].includes(firstToken)) {
    return {
      intent: 'opt_out',
      channel,
      confidence: 1,
      priority: 'normal',
      recommendedActions: ['suppress_contact', 'mark_conversation_resolved'],
    }
  }

  if (['start', 'unstop', 'yes'].includes(firstToken)) {
    return {
      intent: 'opt_in',
      channel,
      confidence: 0.95,
      priority: 'normal',
      recommendedActions: ['restore_contact_opt_in', 'keep_conversation_open'],
    }
  }

  if (/\b(help|support|info)\b/.test(normalised)) {
    return {
      intent: 'help_request',
      channel,
      confidence: 0.75,
      priority: 'normal',
      recommendedActions: ['route_to_support_queue', 'keep_conversation_open'],
    }
  }

  if (/\b(balance|points|saldo|rewards?)\b/.test(normalised)) {
    return {
      intent: 'balance_request',
      channel,
      confidence: 0.82,
      priority: 'normal',
      recommendedActions: ['send_profile_balance', 'keep_conversation_open'],
    }
  }

  if (/\b(urgent|emergency|otp|password|not working|broken|fraud|stolen)\b/.test(normalised)) {
    return {
      intent: 'urgent_support',
      channel,
      confidence: 0.8,
      priority: 'urgent',
      recommendedActions: ['set_priority_urgent', 'route_to_support_queue', 'notify_human_agent'],
    }
  }

  return {
    intent: 'general_reply',
    channel,
    confidence: 0.5,
    priority: 'normal',
    recommendedActions: ['keep_conversation_open'],
  }
}

export function buildHermesConversationSuggestion({
  conversation,
  messages,
  profile,
}: {
  conversation: Conversation
  messages: ConversationMessage[]
  profile?: Record<string, unknown> | null
}): HermesCommunicationSuggestion {
  const lastInbound =
    [...messages].reverse().find((message) => message.direction === 'inbound') ?? messages[messages.length - 1]
  const classification = classifyInboundMessage(lastInbound?.body ?? '', conversation.channel)
  const recommendedOwnerAgentId = ownerForIntent(classification.intent)
  const labels = labelsForIntent(classification.intent, conversation)
  const balance = profile?.pointsBalance ?? conversation.contactSnapshot.pointsBalance

  return {
    mode: 'internal_copilot',
    directSendAllowed: false,
    summary: buildSummary(classification.intent, lastInbound?.body ?? '', conversation),
    detectedIntent: classification.intent,
    recommendedOwnerAgentId,
    recommendedPriority: classification.priority,
    recommendedLabels: labels,
    draftReply: buildDraftReply(classification.intent, balance),
    recommendedActions: classification.recommendedActions,
  }
}

export function shouldAutoReplyAfterHours({
  now,
  timezone,
  businessHours,
}: {
  now: Date
  timezone: string
  businessHours: {
    daysOfWeek: number[]
    startHourLocal: number
    endHourLocal: number
  }
}): boolean {
  const local = getLocalParts(now, timezone)
  if (!businessHours.daysOfWeek.includes(local.dayOfWeek)) return true
  return local.hour < businessHours.startHourLocal || local.hour >= businessHours.endHourLocal
}

function ownerForIntent(intent: InboundClassification['intent']): HermesCommunicationSuggestion['recommendedOwnerAgentId'] {
  if (intent === 'balance_request' || intent === 'opt_out' || intent === 'opt_in') return 'nora'
  if (intent === 'urgent_support' || intent === 'help_request') return 'pip'
  return 'pip'
}

function labelsForIntent(intent: InboundClassification['intent'], conversation: Conversation): string[] {
  const labels = new Set(conversation.labels ?? [])
  if (intent === 'balance_request') labels.add('loyalty-context')
  if (intent === 'opt_out') labels.add('compliance')
  if (intent === 'urgent_support') labels.add('urgent')
  if (conversation.campaignId) labels.add('campaign-reply')
  return Array.from(labels)
}

function buildSummary(intent: InboundClassification['intent'], body: string, conversation: Conversation): string {
  const contactName = conversation.contactSnapshot.name || conversation.contactSnapshot.firstName || 'The contact'
  if (intent === 'balance_request') return `${contactName} is asking for their balance or points context.`
  if (intent === 'opt_out') return `${contactName} appears to be opting out and needs suppression handling.`
  if (intent === 'urgent_support') return `${contactName} sent an urgent support signal: ${body.slice(0, 120)}`
  return `${contactName} replied on ${conversation.channel}.`
}

function buildDraftReply(intent: InboundClassification['intent'], balance: unknown): string {
  if (intent === 'balance_request') {
    const balanceText = balance === undefined || balance === null || balance === ''
      ? 'latest available balance'
      : `${balance} points`
    return `I can help with your balance. I am checking the member profile and will confirm the ${balanceText}.`
  }
  if (intent === 'opt_out') {
    return 'I can help with that. I will update your communication preferences and confirm once it is done.'
  }
  if (intent === 'urgent_support') {
    return 'I have flagged this as urgent and a human agent is reviewing it now.'
  }
  return 'Thanks for the message. I am checking this and will come back to you shortly.'
}

function getLocalParts(now: Date, timezone: string): { dayOfWeek: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return { dayOfWeek: dayMap[weekday] ?? 0, hour }
}
