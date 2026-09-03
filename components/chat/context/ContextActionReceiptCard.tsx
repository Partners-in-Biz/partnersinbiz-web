'use client'

import { Icon } from '@/components/studio'
import type { ChatContextActionReceipt } from '@/lib/chat-context/types'

const receiptPresentation = {
  running: {
    icon: 'progress_activity',
    label: 'Action running',
    className: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
  },
  succeeded: {
    icon: 'task_alt',
    label: 'Action completed',
    className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
  },
  failed: {
    icon: 'error',
    label: 'Action failed',
    className: 'border-red-400/30 bg-red-500/10 text-red-100',
  },
  indeterminate: {
    icon: 'help',
    label: 'Result needs checking',
    className: 'border-amber-400/30 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] text-[var(--st-warning)]',
  },
} as const

function displayTime(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function ContextActionReceiptCard({ receipt }: { receipt: ChatContextActionReceipt }) {
  const presentation = receiptPresentation[receipt.status]
  const reference = receipt.referenceIds
    ? Object.entries(receipt.referenceIds)[0]
    : undefined
  return (
    <section
      aria-label="Action receipt"
      data-testid="context-action-receipt"
      data-status={receipt.status}
      className={`rounded-[6px] border p-3 ${presentation.className}`}
    >
      <div className="flex items-start gap-2">
        <Icon name={presentation.icon} className={`mt-0.5 text-[18px] ${receipt.status === 'running' ? 'animate-spin' : ''}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-label uppercase tracking-[0.16em]">{presentation.label}</p>
          <p className="mt-1 text-xs font-medium">{receipt.action.label}</p>
          {receipt.error && <p className="mt-1 text-[11px] leading-relaxed opacity-85">{receipt.error}</p>}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] opacity-70">
            <span>Receipt {receipt.id.slice(0, 10)}</span>
            {displayTime(receipt.completedAt ?? receipt.createdAt) && <span>{displayTime(receipt.completedAt ?? receipt.createdAt)}</span>}
            {receipt.canonicalStatus && <span>HTTP {receipt.canonicalStatus}</span>}
            {reference && <span>{reference[0]} {reference[1]}</span>}
          </div>
        </div>
        {receipt.resultHref && (
          <a href={receipt.resultHref} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-current/20 px-2 text-[10px] font-medium">
            Open<Icon name="open_in_new" className="text-[13px]" />
          </a>
        )}
      </div>
    </section>
  )
}
