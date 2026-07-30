'use client'

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
    className: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
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
      className={`rounded-xl border p-3 ${presentation.className}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className={`material-symbols-outlined mt-0.5 text-[18px] ${receipt.status === 'running' ? 'animate-spin' : ''}`}>
          {presentation.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-label uppercase tracking-[0.16em]">{presentation.label}</p>
          <p className="mt-1 text-xs font-semibold">{receipt.action.label}</p>
          {receipt.error && <p className="mt-1 text-[11px] leading-relaxed opacity-85">{receipt.error}</p>}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] opacity-70">
            <span>Receipt {receipt.id.slice(0, 10)}</span>
            {displayTime(receipt.completedAt ?? receipt.createdAt) && <span>{displayTime(receipt.completedAt ?? receipt.createdAt)}</span>}
            {receipt.canonicalStatus && <span>HTTP {receipt.canonicalStatus}</span>}
            {reference && <span>{reference[0]} {reference[1]}</span>}
          </div>
        </div>
        {receipt.resultHref && (
          <a href={receipt.resultHref} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-current/20 px-2 text-[10px] font-semibold">
            Open<span aria-hidden="true" className="material-symbols-outlined text-[13px]">open_in_new</span>
          </a>
        )}
      </div>
    </section>
  )
}
