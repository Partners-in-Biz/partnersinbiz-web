'use client'

import type { ActionCardPart } from '@/lib/chat/parts'
import { Icon } from '@/components/studio'

const KIND_ICON: Record<ActionCardPart['kind'], string> = {
  email_sent: 'mail',
  file_written: 'description',
  pr_opened: 'merge',
  post_scheduled: 'schedule',
  routine_run: 'autorenew',
  custom: 'bolt',
}

const STATUS_LABEL: Record<NonNullable<ActionCardPart['status']>, string> = {
  pending: 'Pending',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export function ActionCardPartView({ part }: { part: ActionCardPart }) {
  const icon = KIND_ICON[part.kind] ?? KIND_ICON.custom
  const status = part.status ? STATUS_LABEL[part.status] : null
  const inner = (
    <article
      data-testid="action-card-part"
      data-action-kind={part.kind}
      className="my-2 rounded-[8px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <Icon name={icon} className="mt-0.5 text-[16px] text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-[13px] font-medium text-[var(--color-pib-text)]">{part.title}</h4>
            {status ? (
              <span className="shrink-0 rounded border border-[var(--color-pib-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
                {status}
              </span>
            ) : null}
          </div>
          {part.detail ? (
            <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-pib-text-muted)]">{part.detail}</p>
          ) : null}
        </div>
      </div>
    </article>
  )
  if (part.url) {
    return (
      <a href={part.url} target="_blank" rel="noopener noreferrer" className="block no-underline hover:opacity-95">
        {inner}
      </a>
    )
  }
  return inner
}
