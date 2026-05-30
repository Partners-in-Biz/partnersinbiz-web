// components/admin/crm/ActivityTimeline.tsx

const TYPE_LABELS: Record<string, string> = {
  email_sent: 'Email sent',
  email_received: 'Email received',
  call: 'Call',
  note: 'Note',
  stage_change: 'Stage changed',
  sequence_enrolled: 'Enrolled in sequence',
  sequence_completed: 'Sequence completed',
}

interface Activity {
  id: string
  type: string
  summary: string
  createdAt: { seconds: number } | null
}

interface ActivityTimelineProps {
  activities: Activity[]
  loading: boolean
  contactName?: string
  onAddNote?: () => void
}

export function ActivityTimeline({ activities, loading, contactName, onAddNote }: ActivityTimelineProps) {
  const contactLabel = contactName?.trim() || 'this contact'

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-surface-container animate-pulse" />
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container/30 px-5 py-6 text-center">
        <span
          aria-hidden="true"
          className="material-symbols-outlined mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-outline-variant bg-surface-container text-[22px] text-[var(--color-accent-v2)]"
        >
          history_edu
        </span>
        <p className="mt-4 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
          Relationship history missing
        </p>
        <h3 className="mt-2 text-base font-semibold text-on-surface">
          {`Start ${contactLabel}'s activity trail`}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-on-surface-variant">
          No emails, calls, notes, stage changes, or sequence events are captured yet. Log the first note so managers can see ownership, context, and the next handoff.
        </p>
        {onAddNote && (
          <button
            type="button"
            onClick={onAddNote}
            aria-label={`Log first activity note for ${contactLabel}`}
            className="btn-pib-secondary mx-auto mt-5 inline-flex items-center justify-center gap-1.5 text-xs"
          >
            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">add_comment</span>
            Log first note
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {activities.map((a, i) => (
        <div key={a.id} className={`flex gap-4 pb-4 ${i < activities.length - 1 ? 'border-b border-outline-variant' : ''}`}>
          <div className="pt-1 shrink-0">
            <div className="w-1.5 h-1.5 bg-on-surface-variant rounded-full mt-1.5" />
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-0.5">
              {TYPE_LABELS[a.type] ?? a.type}
              {a.createdAt && (
                <span className="ml-2 normal-case">
                  · {new Date(a.createdAt.seconds * 1000).toLocaleDateString()}
                </span>
              )}
            </p>
            <p className="text-sm text-on-surface">{a.summary}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
