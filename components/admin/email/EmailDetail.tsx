// components/admin/email/EmailDetail.tsx
'use client'
import { fmtTimestamp } from '@/lib/format/timestamp'

interface EmailDetailProps {
  email: {
    id: string
    to: string
    from: string
    cc?: string[]
    subject: string
    bodyHtml: string
    bodyText: string
    status: string
    sentAt: unknown
    scheduledFor: unknown
    createdAt: unknown
  } | null
  loading: boolean
}

export function EmailDetail({ email, loading }: EmailDetailProps) {
  if (loading) {
    return (
      <div className="flex-1 p-6 space-y-3">
        <div className="h-8 bg-surface-container animate-pulse w-1/2" />
        <div className="h-4 bg-surface-container animate-pulse w-1/3" />
        <div className="h-4 bg-surface-container animate-pulse w-1/4" />
        <div className="mt-6 h-40 bg-surface-container animate-pulse" />
      </div>
    )
  }

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-on-surface-variant text-sm">Select an email to read it.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Subject + status */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <h2 className="font-headline text-xl font-bold tracking-tight text-on-surface">
          {email.subject || '(no subject)'}
        </h2>
        <span className="border border-outline-variant text-[10px] font-label uppercase tracking-widest px-2 py-0.5 text-on-surface-variant shrink-0">
          {email.status}
        </span>
      </div>

      {/* Meta */}
      <dl className="text-sm space-y-1 mb-6">
        <div className="flex gap-2">
          <dt className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant w-12 pt-0.5">From</dt>
          <dd className="text-on-surface">{email.from}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant w-12 pt-0.5">To</dt>
          <dd className="text-on-surface">{email.to}</dd>
        </div>
        {email.cc && email.cc.length > 0 && (
          <div className="flex gap-2">
            <dt className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant w-12 pt-0.5">CC</dt>
            <dd className="text-on-surface">{email.cc.join(', ')}</dd>
          </div>
        )}
        {!!email.sentAt && (
          <div className="flex gap-2">
            <dt className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant w-12 pt-0.5">Sent</dt>
            <dd className="text-on-surface">{fmtTimestamp(email.sentAt)}</dd>
          </div>
        )}
        {!!email.scheduledFor && (
          <div className="flex gap-2">
            <dt className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant w-12 pt-0.5">Sched</dt>
            <dd className="text-on-surface">{fmtTimestamp(email.scheduledFor)}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant w-12 pt-0.5">Created</dt>
          <dd className="text-on-surface">{fmtTimestamp(email.createdAt)}</dd>
        </div>
      </dl>

      {/* Body */}
      <div className="border border-outline-variant p-4">
        {email.bodyHtml ? (
          <div
            className="text-sm text-on-surface prose-sm"
            dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
          />
        ) : (
          <pre className="text-sm text-on-surface whitespace-pre-wrap font-sans">{email.bodyText}</pre>
        )}
      </div>
    </div>
  )
}
