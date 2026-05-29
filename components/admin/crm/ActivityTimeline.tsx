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
  onAddNote?: () => void
}

export function ActivityTimeline({ activities, loading, onAddNote }: ActivityTimelineProps) {
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
      <div className="py-6 text-center">
        <p className="text-on-surface-variant text-sm">
          No activity yet. Send an email or add a note to get started.
        </p>
        {onAddNote && (
          <button
            type="button"
            onClick={onAddNote}
            className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold text-[var(--color-accent-v2)] transition-colors hover:border-[var(--color-accent-v2)] hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">add_comment</span>
            Log first note from activity timeline
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
