'use client'
import { gmailThreadUrl } from './googleDeepLinks'
import type { MailItem } from './useUnreadEmail'

type Props = {
  status: 'connected' | 'not_connected'
  messages: MailItem[]
  unreadCount: number
  loading: boolean
  onAskPipReply: (mail: MailItem) => void
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function InboxPanel({ status, messages, unreadCount, loading, onAskPipReply }: Props) {
  if (loading) {
    return <div className="p-4 text-sm text-on-surface-variant">Loading inbox&hellip;</div>
  }
  if (status === 'not_connected') {
    return (
      <div className="p-4 text-sm text-on-surface-variant">
        No Gmail account connected.{' '}
        <a href="/portal/email" className="text-[var(--color-pib-accent)] hover:underline">
          Connect Gmail
        </a>
      </div>
    )
  }
  if (messages.length === 0) {
    return <div className="p-4 text-sm text-on-surface-variant">No unread emails.</div>
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {messages.map((mail) => (
        <div
          key={mail.id}
          className="rounded-lg border-y border-r border-l-4 border-[var(--color-card-border)] border-l-blue-400 bg-[var(--color-card)] p-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-bold text-on-surface">{mail.from}</span>
            <span className="shrink-0 text-[10px] text-on-surface-variant">
              {timeAgo(mail.receivedAt)}
            </span>
          </div>
          <div className="mt-0.5 text-xs font-medium text-on-surface">{mail.subject}</div>
          <div className="mt-0.5 line-clamp-1 text-[11px] text-on-surface-variant">
            {mail.snippet}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              onClick={() => onAskPipReply(mail)}
              className="pib-btn-primary px-2 py-1 text-[10px]"
            >
              ✦ Ask Pip to reply
            </button>
            <a
              href={gmailThreadUrl(mail.threadId)}
              target="_blank"
              rel="noopener noreferrer"
              className="pib-btn-secondary px-2 py-1 text-[10px]"
            >
              Open in Gmail
            </a>
          </div>
        </div>
      ))}
      {unreadCount > messages.length && (
        <div className="rounded-lg border border-dashed border-[var(--color-card-border)] py-2 text-center text-xs text-on-surface-variant">
          ↓ See {unreadCount - messages.length} more unread
        </div>
      )}
    </div>
  )
}
