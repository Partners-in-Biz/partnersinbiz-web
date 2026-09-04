'use client'

import type { SystemEventPart } from '@/lib/chat/parts'
import { Icon } from '@/components/studio'

export function SystemEventPartView({ part }: { part: SystemEventPart }) {
  const at = (() => {
    try {
      return new Date(part.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  })()
  const body = (
    <div
      data-testid="system-event-part"
      data-event-kind={part.eventKind}
      className="my-1.5 flex items-center gap-2 text-[11px] text-[var(--color-pib-text-muted)]"
    >
      <Icon name="info" className="text-[14px] text-primary/80" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-[var(--color-pib-text)]">{part.actorLabel}</span>
        {' — '}
        {part.summary}
      </span>
      {at ? <time dateTime={part.at} className="shrink-0 tabular-nums">{at}</time> : null}
    </div>
  )
  if (part.href) {
    return (
      <a href={part.href} className="block no-underline hover:opacity-90">
        {body}
      </a>
    )
  }
  return body
}
