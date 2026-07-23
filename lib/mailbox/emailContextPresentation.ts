import type { MailboxMessageSafe } from '@/lib/mailbox/types'

export type EmailOpenContextUiAction = {
  id: string
  type: 'open_context'
  label: string
  variant: 'primary'
  payload: {
    kind: 'email'
    id: string
    label?: string
  }
}

export type EmailContextPresentation = {
  contextRef: {
    type: 'email'
    id: string
    label: string
    origin: 'manual'
    summary?: string
  }
  uiActions: EmailOpenContextUiAction[]
}

export function buildEmailContextPresentation(message: Pick<MailboxMessageSafe, 'id' | 'subject' | 'snippet' | 'to' | 'from'>): EmailContextPresentation {
  const subject = message.subject?.trim() || '(no subject)'
  const to = Array.isArray(message.to) ? message.to.filter(Boolean).join(', ') : ''
  const summaryParts = [
    `status: draft`,
    message.from ? `from: ${message.from}` : '',
    to ? `to: ${to}` : '',
    message.snippet ? message.snippet : '',
  ].filter(Boolean)
  return {
    contextRef: {
      type: 'email',
      id: message.id,
      label: subject,
      origin: 'manual',
      summary: summaryParts.join(' | ').slice(0, 700),
    },
    uiActions: [{
      id: `open-email-draft:${message.id}`,
      type: 'open_context',
      label: 'Review email draft',
      variant: 'primary',
      payload: {
        kind: 'email',
        id: message.id,
        label: subject,
      },
    }],
  }
}
