import type { ApiUser } from '@/lib/api/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ChatContextReadModel,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import { adminDb } from '@/lib/firebase/admin'
import { getSupportTicket, listSupportMessages } from '@/lib/support/store'
import type {
  SupportMessage,
  SupportPriority,
  SupportStatus,
  SupportTicket,
} from '@/lib/support/types'

const PRIORITIES: SupportPriority[] = ['low', 'normal', 'high', 'urgent']

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    const raw = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; _seconds?: number }
    try {
      const converted = raw.toDate?.()
      if (converted && !Number.isNaN(converted.getTime())) return converted.toISOString()
      const millis = raw.toMillis?.()
      if (typeof millis === 'number' && Number.isFinite(millis)) return new Date(millis).toISOString()
      const seconds = raw.seconds ?? raw._seconds
      if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function stateFor(status: SupportStatus, priority: SupportPriority): ContextDisplayState {
  if (status === 'resolved') return 'complete'
  if (priority === 'urgent') return 'blocked'
  if (status === 'waiting_on_us' || status === 'new') return 'needs_input'
  return 'waiting'
}

function nextPriority(priority: SupportPriority): SupportPriority | null {
  const index = PRIORITIES.indexOf(priority)
  return index >= 0 && index < PRIORITIES.length - 1 ? PRIORITIES[index + 1] : null
}

export function supportChatActions(input: {
  ticket: SupportTicket
  user: ApiUser
}): ChatContextAction[] {
  if (input.user.role !== 'admin') return []
  const id = encodeURIComponent(input.ticket.id)
  const href = `/api/v1/admin/support/${id}`
  const actions: ChatContextAction[] = []

  if (input.ticket.assigneeUserId !== input.user.uid) {
    actions.push({
      id: `claim-support-ticket:${input.ticket.id}`,
      label: 'Assign to me',
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { assigneeUserId: input.user.uid },
    })
  }

  const raisedPriority = nextPriority(input.ticket.priority)
  if (input.ticket.status !== 'resolved' && raisedPriority) {
    actions.push({
      id: `raise-support-priority:${input.ticket.id}:${raisedPriority}`,
      label: `Raise priority to ${titleCase(raisedPriority)}`,
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { priority: raisedPriority },
    })
  }

  if (input.ticket.status === 'resolved') {
    actions.push({
      id: `reopen-support-ticket:${input.ticket.id}`,
      label: 'Reopen ticket',
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { status: 'waiting_on_us' },
    })
  } else {
    actions.push({
      id: `resolve-support-ticket:${input.ticket.id}`,
      label: 'Resolve ticket',
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { status: 'resolved' },
    })
  }

  return actions
}

async function assigneeLabel(ticket: SupportTicket): Promise<string> {
  if (ticket.assignedToType === 'user' && ticket.assigneeUserId) {
    const snap = await adminDb.collection('users').doc(ticket.assigneeUserId).get()
    if (snap.exists) {
      const data = snap.data() ?? {}
      return clean(data.name, 100) || clean(data.displayName, 100) || clean(data.email, 120) || 'Assigned member'
    }
    return 'Assigned member'
  }
  if (ticket.assignedToType === 'agent' && ticket.assigneeAgentId) {
    const snap = await adminDb.collection('agents').doc(ticket.assigneeAgentId).get()
    if (snap.exists) {
      const data = snap.data() ?? {}
      return clean(data.name, 100) || clean(data.displayName, 100) || clean(data.label, 100) || ticket.assigneeAgentId
    }
    return ticket.assigneeAgentId
  }
  return 'Unassigned'
}

function messageActivity(messages: SupportMessage[]): ContextActivitySummary[] {
  return messages.flatMap((message) => {
    const occurredAt = dateString(message.createdAt)
    if (!occurredAt) return []
    return [{
      id: `message:${message.id}`,
      type: message.authorRole === 'client' ? 'input_required' as const : 'waiting' as const,
      label: message.authorRole === 'client' ? 'Client replied' : 'Operator replied',
      occurredAt,
      detail: clean(message.body),
      actorLabel: clean(message.authorName, 100),
    }]
  }).sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 8)
}

export const supportChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'support') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported support context' }
    }
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base
    const ticket = await getSupportTicket(input.id)
    if (!ticket || ticket.orgId !== base.model.context.orgId) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }
    if (input.user.role === 'client' && ticket.createdBy !== input.user.uid) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const [messages, assignedTo] = await Promise.all([
      listSupportMessages(ticket.id),
      assigneeLabel(ticket),
    ])
    const actions = supportChatActions({ ticket, user: input.user })
    const href = input.user.role === 'client'
      ? `/portal/dashboard?support=open&ticket=${encodeURIComponent(ticket.id)}&orgId=${encodeURIComponent(ticket.orgId)}`
      : `/admin/support?ticket=${encodeURIComponent(ticket.id)}`
    const attention: ContextAttentionSummary[] = []
    if (ticket.status === 'new' || ticket.status === 'waiting_on_us') {
      attention.push({
        id: 'support-response-due',
        label: ticket.status === 'new' ? 'New ticket needs triage' : 'Client is waiting for a response',
        state: 'needs_input',
        detail: clean(ticket.lastMessagePreview) || clean(ticket.description),
        href,
      })
    }
    if (ticket.priority === 'urgent' && ticket.status !== 'resolved') {
      attention.push({
        id: 'urgent-support-ticket',
        label: 'Urgent support ticket',
        state: 'blocked',
        detail: `${titleCase(ticket.category)} · ${assignedTo}`,
        href,
      })
    }

    const metrics: ChatContextReadModel['pulse']['metrics'] = [
      { id: 'status', label: 'Status', value: titleCase(ticket.status) },
      { id: 'priority', label: 'Priority', value: titleCase(ticket.priority) },
      { id: 'category', label: 'Category', value: titleCase(ticket.category) },
      { id: 'messages', label: 'Messages', value: messages.length || ticket.messageCount },
      { id: 'assignee', label: 'Assignee', value: assignedTo },
    ]
    const recentMessages = messages.slice(-8).reverse()

    return {
      ok: true,
      model: {
        context: { ...base.model.context, href },
        pulse: {
          label: 'Support ticket',
          metrics,
          headline: `${ticket.requesterName}${ticket.requesterEmail ? ` · ${ticket.requesterEmail}` : ''}`,
          next: attention[0]
            ? {
                id: attention[0].id,
                label: attention[0].label,
                state: attention[0].state,
                detail: attention[0].detail,
                href,
              }
            : undefined,
        },
        groups: [
          {
            id: 'ticket',
            label: 'Ticket control',
            items: [{
              id: ticket.id,
              label: ticket.subject,
              state: stateFor(ticket.status, ticket.priority),
              detail: clean(ticket.description),
              href,
              ...(dateString(ticket.updatedAt) ? { updatedAt: dateString(ticket.updatedAt) } : {}),
              ...(actions.length > 0 ? { actions } : {}),
            }],
          },
          ...(recentMessages.length > 0 ? [{
            id: 'messages',
            label: 'Latest messages',
            items: recentMessages.map((message) => ({
              id: message.id,
              label: clean(message.authorName, 100) || titleCase(message.authorRole),
              state: message.authorRole === 'client' ? 'needs_input' as const : 'waiting' as const,
              detail: clean(message.body),
              href,
              ...(dateString(message.createdAt) ? { updatedAt: dateString(message.createdAt) } : {}),
            })),
          }] : []),
        ],
        artifacts: [],
        attention,
        activity: messageActivity(messages),
        preview: {
          kind: 'summary',
          text: clean(ticket.lastMessagePreview) || clean(ticket.description),
          status: ticket.status,
          ...(dateString(ticket.updatedAt) ? { version: dateString(ticket.updatedAt) } : {}),
        },
        ...(base.model.relationships?.length ? { relationships: base.model.relationships } : {}),
        capabilities: ['open', 'preview', 'thread', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
