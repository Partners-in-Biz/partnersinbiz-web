'use client'

export interface ContactEngagementEmail {
  id: string
  direction?: string
  subject?: string
}

export interface ContactEngagementActivity {
  id: string
  type?: string
  summary?: string
}

export interface ContactEngagementSuggestion {
  action: string
  reason: string
  urgency: 'high' | 'medium' | 'low'
}

export interface ContactEngagementProfile {
  lastContactedAt?: unknown
  emails?: ContactEngagementEmail[]
  activities?: ContactEngagementActivity[]
  nextSuggestion?: ContactEngagementSuggestion
}

export interface ContactEngagementActions {
  contactName?: string
  onLogNote?: () => void
  onSendEmail?: () => void
  onScheduleMeeting?: () => void
  onStartSuggestion?: (suggestion: ContactEngagementSuggestion) => void
}

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number }
    if (typeof candidate.toMillis === 'function') return candidate.toMillis()
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
  }
  return 0
}

function daysSince(value: unknown): number | null {
  const millis = timestampMillis(value)
  if (!millis) return null
  return Math.max(0, Math.floor((Date.now() - millis) / 86_400_000))
}

function cadenceLabel(days: number | null): string {
  if (days === null) return 'No touch logged'
  if (days <= 7) return 'Warm'
  if (days <= 30) return 'Follow-up due'
  return 'Cold'
}

function Signal({
  icon,
  label,
  value,
}: {
  icon: string
  label: string
  value: string
}) {
  return (
    <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.025] p-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[17px] text-[var(--color-pib-accent)]">{icon}</span>
        <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">{label}</p>
      </div>
      <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">{value}</p>
    </div>
  )
}

export function contactEngagementHealth(profile: ContactEngagementProfile): number {
  const days = daysSince(profile.lastContactedAt)
  const emails = profile.emails ?? []
  const activities = profile.activities ?? []
  const inboundEmails = emails.filter((email) => email.direction === 'inbound').length
  const checks = [
    days !== null && days <= 7,
    emails.length > 0,
    inboundEmails > 0,
    activities.length > 0,
    Boolean(profile.nextSuggestion?.action),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export function ContactEngagementPanel({
  profile,
  actions,
}: {
  profile: ContactEngagementProfile
  actions?: ContactEngagementActions
}) {
  const days = daysSince(profile.lastContactedAt)
  const emails = profile.emails ?? []
  const activities = profile.activities ?? []
  const inboundEmails = emails.filter((email) => email.direction === 'inbound').length
  const health = contactEngagementHealth(profile)
  const cadence = cadenceLabel(days)
  const suggestion = profile.nextSuggestion
  const contactName = actions?.contactName?.trim() || 'this contact'
  const hasActions = Boolean(actions?.onLogNote || actions?.onSendEmail || actions?.onScheduleMeeting)

  return (
    <section className="bento-card !p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow !text-[10px]">Engagement cockpit</p>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
            Cadence, response depth, and the next relationship move in one view.
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl leading-none text-[var(--color-pib-text)]">{health}%</p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">active</p>
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
        <div
          className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all duration-500"
          style={{ width: `${health}%` }}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Signal icon="local_fire_department" label="Cadence" value={cadence} />
        <Signal icon="mail" label="Email thread" value={`${emails.length} email${emails.length === 1 ? '' : 's'}`} />
        <Signal icon="inbox" label="Replies" value={`${inboundEmails} inbound`} />
        <Signal icon="history" label="Timeline" value={`${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`} />
      </div>

      {suggestion ? (
        <div className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">tips_and_updates</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[var(--color-pib-text)]">{suggestion.action}</p>
                <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                  {suggestion.urgency}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{suggestion.reason}</p>
              {actions?.onStartSuggestion ? (
                <button
                  type="button"
                  onClick={() => actions.onStartSuggestion?.(suggestion)}
                  aria-label={`Start suggested action: ${suggestion.action} for ${contactName}`}
                  className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">play_arrow</span>
                  Start action
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.025] p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[18px] text-[var(--color-pib-accent)]"
            >
              psychology
            </span>
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                Next best action missing
              </p>
              <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Create the next relationship signal</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                No AI recommendation is ready yet. Log a note, send an email, or schedule the next touch so the team has enough context to keep the relationship moving.
              </p>
            </div>
          </div>
          {hasActions ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions?.onLogNote ? (
                <button
                  type="button"
                  onClick={actions.onLogNote}
                  aria-label={`Log note from engagement cockpit for ${contactName}`}
                  className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">edit_note</span>
                  Log note
                </button>
              ) : null}
              {actions?.onSendEmail ? (
                <button
                  type="button"
                  onClick={actions.onSendEmail}
                  aria-label={`Send email from engagement cockpit to ${contactName}`}
                  className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">outgoing_mail</span>
                  Send email
                </button>
              ) : null}
              {actions?.onScheduleMeeting ? (
                <button
                  type="button"
                  onClick={actions.onScheduleMeeting}
                  aria-label={`Schedule meeting from engagement cockpit with ${contactName}`}
                  className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">event</span>
                  Schedule meeting
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
