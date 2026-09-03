'use client'

import { Icon } from '@/components/studio'

export interface ContactIdentityProfile {
  jobTitle?: string
  department?: string
  timezone?: string
  phoneVerified?: boolean
  smsOptedIn?: boolean
  unsubscribedAt?: unknown
  bouncedAt?: unknown
  repliesCount?: number
}

type IdentityFieldKey = 'jobTitle' | 'department' | 'timezone'

interface IdentityFieldAction {
  label: string
  ariaLabel: string
  onClick: () => void
}

export type ContactIdentityFieldActions = Partial<Record<IdentityFieldKey, IdentityFieldAction>>

export function contactIdentityHealth(profile: ContactIdentityProfile): number {
  const checks = [
    Boolean(profile.jobTitle?.trim()),
    Boolean(profile.department?.trim()),
    Boolean(profile.timezone?.trim()),
    profile.phoneVerified === true,
    profile.smsOptedIn === true,
    !profile.unsubscribedAt && !profile.bouncedAt,
    (profile.repliesCount ?? 0) > 0,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function Field({ label, value, action }: { label: string; value?: string; action?: IdentityFieldAction }) {
  const displayValue = value || `${label} not captured`

  return (
    <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{label}</p>
      <p className="mt-0.5 text-sm text-[var(--color-pib-text)]">{displayValue}</p>
      {!value && action && (
        <button
          type="button"
          aria-label={action.ariaLabel}
          onClick={action.onClick}
          className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] font-medium text-primary transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
        >
          <Icon name="edit" className="text-[13px]" />
          {action.label}
        </button>
      )}
    </div>
  )
}

function MissingIdentityPanel({ fieldActions }: { fieldActions?: ContactIdentityFieldActions }) {
  const actions = [
    fieldActions?.jobTitle,
    fieldActions?.department,
    fieldActions?.timezone,
  ].filter((action): action is IdentityFieldAction => Boolean(action))

  return (
    <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2.5 py-2.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="shrink-0"
        >
          <Icon name="badge" className="text-[16px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">
            Personalization context missing
          </p>
          <h3 className="mt-0.5 text-sm font-medium text-[var(--color-pib-text)]">Capture role, department, and timezone</h3>
          <p className="mt-0.5 text-xs leading-5 text-[var(--color-pib-text-muted)]">
            Add these fields so every employee can tailor outreach, meeting times, and handoffs around who this contact is and how they work.
          </p>
          {actions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {actions.map((action) => (
                <button
                  key={action.ariaLabel}
                  type="button"
                  aria-label={action.ariaLabel}
                  onClick={action.onClick}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                >
                  <Icon name="edit" className="text-[14px]" />
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Signal({ icon, label, healthy }: { icon: string; label: string; healthy: boolean }) {
  return (
    <span className={`pib-pill ${healthy ? 'pib-pill-success' : ''}`}>
      <Icon name={icon} className="text-[13px]" />
      {label}
    </span>
  )
}

function emailReachabilityLabel(profile: ContactIdentityProfile): string {
  if (profile.bouncedAt) return 'Email bounced'
  if (profile.unsubscribedAt) return 'Email unsubscribed'
  return 'Email reachable'
}

function smsReadinessLabel(profile: ContactIdentityProfile): string {
  if (profile.phoneVerified !== true) return 'Phone unverified'
  if (profile.smsOptedIn !== true) return 'SMS opted out'
  return 'SMS ready'
}

function replySignalLabel(count: number): string {
  if (count === 0) return 'No replies yet'
  return `${count} repl${count === 1 ? 'y' : 'ies'}`
}

export function ContactIdentityPanel({
  profile,
  fieldActions,
}: {
  profile: ContactIdentityProfile
  fieldActions?: ContactIdentityFieldActions
}) {
  const health = contactIdentityHealth(profile)
  const smsReady = profile.phoneVerified === true && profile.smsOptedIn === true
  const smsLabel = smsReadinessLabel(profile)
  const emailReachable = !profile.unsubscribedAt && !profile.bouncedAt
  const emailLabel = emailReachabilityLabel(profile)
  const replies = profile.repliesCount ?? 0
  const missingCoreIdentity = !profile.jobTitle?.trim() && !profile.department?.trim() && !profile.timezone?.trim()

  return (
    <section className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      <div className="flex h-9 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-black/[0.08] px-3">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Identity intelligence</p>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          <span className="text-sm font-medium text-[var(--color-pib-text)]">{health}%</span>
          {' '}
          <span className="text-[10px] uppercase tracking-[0.18em]">complete</span>
        </p>
      </div>

      <div className="space-y-2 p-3">
        <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
          Role, timezone, and channel signals for personal follow-up.
        </p>

        <div className="h-1 overflow-hidden bg-white/10 rounded-md">
          <div
            className="h-full rounded-md bg-primary transition-all duration-500"
            style={{ width: `${health}%` }}
          />
        </div>

        {missingCoreIdentity ? (
          <MissingIdentityPanel fieldActions={fieldActions} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Role" value={profile.jobTitle} action={fieldActions?.jobTitle} />
            <Field label="Department" value={profile.department} action={fieldActions?.department} />
            <Field label="Timezone" value={profile.timezone} action={fieldActions?.timezone} />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Signal icon="sms" label={smsLabel} healthy={smsReady} />
          <Signal icon="mark_email_read" label={emailLabel} healthy={emailReachable} />
          <Signal icon="forum" label={replySignalLabel(replies)} healthy={replies > 0} />
        </div>
      </div>
    </section>
  )
}
