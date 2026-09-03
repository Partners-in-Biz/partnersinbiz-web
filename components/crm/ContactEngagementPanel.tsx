'use client'

import { Icon } from '@/components/studio'

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

function inboundReplyLabel(count: number): string {
  if (count === 0) return 'No inbound replies'
  return `${count} inbound repl${count === 1 ? 'y' : 'ies'}`
}

function emailThreadLabel(count: number): string {
  if (count === 0) return 'No email thread'
  return `${count} email${count === 1 ? '' : 's'}`
}

function activityTrailLabel(count: number): string {
  if (count === 0) return 'No activity trail'
  return `${count} activit${count === 1 ? 'y' : 'ies'}`
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
    <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
      <div className="flex items-center gap-1.5">
        <Icon name={icon} className="text-[14px]" />
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{label}</p>
      </div>
      <p className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{value}</p>
    </div>
  )
}

function EngagementCommandButtons({
  actions,
  contactName,
}: {
  actions?: ContactEngagementActions
  contactName: string
}) {
  const hasActions = Boolean(actions?.onLogNote || actions?.onSendEmail || actions?.onScheduleMeeting)

  if (!hasActions) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {actions?.onLogNote ? (
        <button
          type="button"
          onClick={actions.onLogNote}
          aria-label={`Log note from engagement cockpit for ${contactName}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
        >
          <Icon name="edit_note" className="text-[14px]" />
          Log note
        </button>
      ) : null}
      {actions?.onSendEmail ? (
        <button
          type="button"
          onClick={actions.onSendEmail}
          aria-label={`Send email from engagement cockpit to ${contactName}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
        >
          <Icon name="outgoing_mail" className="text-[14px]" />
          Send email
        </button>
      ) : null}
      {actions?.onScheduleMeeting ? (
        <button
          type="button"
          onClick={actions.onScheduleMeeting}
          aria-label={`Schedule meeting from engagement cockpit with ${contactName}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
        >
          <Icon name="event" className="text-[14px]" />
          Schedule meeting
        </button>
      ) : null}
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
  const suggestionActionLabel = suggestion?.action?.trim() || 'Suggested action missing'
  const suggestionReasonLabel = suggestion?.reason?.trim() || 'Suggestion reason missing'
  const contactName = actions?.contactName?.trim() || 'this contact'

  return (
    <section className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      <div className="flex h-9 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-black/[0.08] px-3">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Engagement cockpit</p>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          <span className="text-sm font-medium text-[var(--color-pib-text)]">{health}%</span>
          {' '}
          <span className="text-[10px] uppercase tracking-[0.18em]">active</span>
        </p>
      </div>

      <div className="space-y-2 p-3">
        <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
          Cadence, response depth, and the next relationship move in one view.
        </p>

        <div className="h-1 overflow-hidden bg-white/10 rounded-md">
          <div
            className="h-full rounded-md bg-primary transition-all duration-500"
            style={{ width: `${health}%` }}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <Signal icon="local_fire_department" label="Cadence" value={cadence} />
          <Signal icon="mail" label="Email thread" value={emailThreadLabel(emails.length)} />
          <Signal icon="inbox" label="Replies" value={inboundReplyLabel(inboundEmails)} />
          <Signal icon="history" label="Timeline" value={activityTrailLabel(activities.length)} />
        </div>

        {suggestion ? (
          <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2.5 py-2.5">
            <div className="flex items-start gap-2.5">
              <Icon name="tips_and_updates" className="text-[16px] text-primary" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-[var(--color-pib-text)]">{suggestionActionLabel}</p>
                  <span className={`pib-pill ${suggestion.urgency === 'high' ? 'pib-pill-danger' : suggestion.urgency === 'medium' ? 'pib-pill-warn' : 'pib-pill-accent'}`}>
                    {suggestion.urgency}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-5 text-[var(--color-pib-text-muted)]">{suggestionReasonLabel}</p>
                {actions?.onStartSuggestion ? (
                  <button
                    type="button"
                    onClick={() => actions.onStartSuggestion?.(suggestion)}
                    aria-label={`Start suggested action: ${suggestionActionLabel} for ${contactName}`}
                    className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2.5 text-xs font-medium text-primary transition hover:bg-primary/15"
                  >
                    <Icon name="play_arrow" className="text-[14px]" />
                    Start action
                  </button>
                ) : null}
                <EngagementCommandButtons actions={actions} contactName={contactName} />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2.5 py-2.5">
            <div className="flex items-start gap-2.5">
              <Icon name="psychology" className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-[16px] text-primary" />
              <div>
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">
                  Next best action missing
                </p>
                <h3 className="mt-0.5 text-sm font-medium text-[var(--color-pib-text)]">Create the next relationship signal</h3>
                <p className="mt-0.5 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  No AI recommendation is ready yet. Log a note, send an email, or schedule the next touch so the team has enough context to keep the relationship moving.
                </p>
              </div>
            </div>
            <EngagementCommandButtons actions={actions} contactName={contactName} />
          </div>
        )}
      </div>
    </section>
  )
}
