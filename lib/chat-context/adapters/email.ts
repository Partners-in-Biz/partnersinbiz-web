import { ownerUidFrom } from '@/lib/api/actor'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import { adminDb } from '@/lib/firebase/admin'
import { serializeMessage } from '@/lib/mailbox/serializers'
import type { MailboxFolder, MailboxMessageSafe } from '@/lib/mailbox/types'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function messageHref(message: MailboxMessageSafe, role: string): string {
  const params = new URLSearchParams({ folder: message.folder, messageId: message.id })
  if (role === 'client') params.set('orgId', message.orgId)
  return `${role === 'client' ? '/portal/email' : '/admin/email/mailbox'}?${params.toString()}`
}

function actionEndpoint(message: MailboxMessageSafe, role: string): string {
  return role === 'client'
    ? `/api/v1/portal/email/messages/${encodeURIComponent(message.id)}?orgId=${encodeURIComponent(message.orgId)}`
    : `/api/v1/admin/mailbox/messages/${encodeURIComponent(message.id)}`
}

export function emailChatActions(message: MailboxMessageSafe, role: string): ChatContextAction[] {
  if (role !== 'admin' && role !== 'client') return []
  const href = actionEndpoint(message, role)
  const actions: ChatContextAction[] = [
    {
      id: `${message.read ? 'mark-unread' : 'mark-read'}-email:${message.id}`,
      label: message.read ? 'Mark unread' : 'Mark read',
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { read: !message.read },
    },
    {
      id: `${message.starred ? 'unstar' : 'star'}-email:${message.id}`,
      label: message.starred ? 'Remove star' : 'Star email',
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { starred: !message.starred },
    },
  ]
  if (message.folder === 'inbox' || message.folder === 'sent') {
    actions.push({
      id: `archive-email:${message.id}`,
      label: 'Archive email',
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { folder: 'archive' satisfies MailboxFolder },
    })
  } else if (message.folder === 'archive') {
    actions.push({
      id: `restore-email:${message.id}`,
      label: 'Move to inbox',
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { folder: 'inbox' satisfies MailboxFolder },
    })
  }
  return actions
}

function stateFor(message: MailboxMessageSafe): ContextDisplayState {
  if (message.status === 'failed') return 'blocked'
  if (message.folder === 'trash') return 'archived'
  if (message.status === 'queued') return 'waiting'
  if (message.status === 'draft') return 'needs_input'
  if (!message.read && message.direction === 'inbound') return 'needs_input'
  if (message.status === 'sent') return 'complete'
  return 'ready'
}

function activityFor(message: MailboxMessageSafe): ContextActivitySummary[] {
  const primaryAt = message.receivedAt || message.sentAt || message.createdAt
  const updatedAt = message.updatedAt
  return [
    ...(updatedAt ? [{
      id: 'email-updated',
      type: 'running' as const,
      label: 'Email updated',
      occurredAt: updatedAt,
    }] : []),
    ...(primaryAt ? [{
      id: message.direction === 'inbound' ? 'email-received' : message.status === 'draft' ? 'email-drafted' : 'email-sent',
      type: message.status === 'failed' ? 'failure' as const : message.status === 'draft' ? 'pickup' as const : 'verified_complete' as const,
      label: message.direction === 'inbound' ? 'Email received' : message.status === 'draft' ? 'Draft created' : 'Email sent',
      occurredAt: primaryAt,
    }] : []),
  ]
}

export const emailChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'email') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported email context' }
    }
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base
    const snap = await adminDb.collection('mailbox_messages').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const data = snap.data() ?? {}
    const message = serializeMessage(snap.id, data)
    if (message.orgId !== base.model.context.orgId || message.uid !== ownerUidFrom(input.user)) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const href = messageHref(message, input.user.role)
    const actions = emailChatActions(message, input.user.role)
    const counterpart = message.direction === 'inbound'
      ? clean(message.fromName, 120) || clean(message.from, 180)
      : message.to.map((item) => clean(item, 120)).filter(Boolean).join(', ')
    const timing = message.receivedAt || message.sentAt || message.updatedAt || message.createdAt || ''
    const detail = [
      counterpart ? `${message.direction === 'inbound' ? 'From' : 'To'}: ${counterpart}` : '',
      message.accountEmail ? `Mailbox: ${message.accountEmail}` : '',
      timing,
    ].filter(Boolean).join(' · ')
    const attention: ContextAttentionSummary[] = message.status === 'failed'
      ? [{
          id: 'email-send-failed',
          label: 'Email delivery failed',
          state: 'blocked',
          detail: 'Open the mailbox to review the draft and delivery settings.',
          href,
        }]
      : !message.read && message.direction === 'inbound'
        ? [{
            id: 'email-unread',
            label: 'Unread email needs review',
            state: 'needs_input',
            detail: clean(message.snippet),
            href,
            ...(actions.length > 0 ? { actions } : {}),
          }]
        : message.status === 'draft'
          ? [{
              id: 'email-draft',
              label: 'Draft needs review',
              state: 'needs_input',
              detail: 'Content, recipients, and sending remain an authored mailbox workflow.',
              href,
            }]
          : []

    return {
      ok: true,
      model: {
        context: {
          ...base.model.context,
          label: clean(message.subject, 180) || '(no subject)',
          href,
        },
        pulse: {
          label: 'Mailbox message',
          metrics: [
            { id: 'status', label: 'Status', value: titleCase(message.status) },
            { id: 'folder', label: 'Folder', value: titleCase(message.folder) },
            { id: 'read', label: 'Read', value: message.read ? 'Yes' : 'No' },
            { id: 'attachments', label: 'Attachments', value: message.attachments.length },
          ],
          headline: clean(message.snippet || message.bodyText, 300) || detail,
          ...(attention[0] ? {
            next: {
              id: attention[0].id,
              label: attention[0].label,
              state: attention[0].state,
              detail: attention[0].detail,
              href,
            },
          } : {}),
        },
        groups: [{
          id: 'message',
          label: 'Email',
          items: [{
            id: message.id,
            label: clean(message.subject, 180) || '(no subject)',
            state: stateFor(message),
            detail,
            href,
            ...(message.updatedAt ? { updatedAt: message.updatedAt } : {}),
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention,
        activity: activityFor(message),
        preview: {
          kind: 'email',
          text: clean(message.bodyText || message.snippet, 700),
          status: message.status,
          ...(message.updatedAt ? { version: message.updatedAt } : {}),
        },
        ...(base.model.relationships ? { relationships: base.model.relationships } : {}),
        capabilities: ['open', 'preview', 'mailbox-metadata', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
