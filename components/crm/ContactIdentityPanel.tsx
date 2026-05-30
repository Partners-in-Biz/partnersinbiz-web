'use client'

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

type IdentityFieldActions = Partial<Record<IdentityFieldKey, IdentityFieldAction>>

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
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">{label}</p>
      <p className="mt-1 text-sm text-[var(--color-pib-text)]">{value || 'Not captured'}</p>
      {!value && action && (
        <button
          type="button"
          aria-label={action.ariaLabel}
          onClick={action.onClick}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
        >
          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">edit</span>
          {action.label}
        </button>
      )}
    </div>
  )
}

function MissingIdentityPanel({ fieldActions }: { fieldActions?: IdentityFieldActions }) {
  const actions = [
    fieldActions?.jobTitle,
    fieldActions?.department,
    fieldActions?.timezone,
  ].filter((action): action is IdentityFieldAction => Boolean(action))

  return (
    <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.025] p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[18px] text-[var(--color-pib-accent)]"
        >
          badge
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            Personalization context missing
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Capture role, department, and timezone</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
            Add these fields so every employee can tailor outreach, meeting times, and handoffs around who this contact is and how they work.
          </p>
          {actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action.ariaLabel}
                  type="button"
                  aria-label={action.ariaLabel}
                  onClick={action.onClick}
                  className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit</span>
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
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
        healthy
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
          : 'border-[var(--color-pib-line)] bg-white/[0.03] text-[var(--color-pib-text-muted)]',
      ].join(' ')}
    >
      <span className="material-symbols-outlined text-[14px]">{icon}</span>
      {label}
    </span>
  )
}

export function ContactIdentityPanel({
  profile,
  fieldActions,
}: {
  profile: ContactIdentityProfile
  fieldActions?: IdentityFieldActions
}) {
  const health = contactIdentityHealth(profile)
  const smsReady = profile.phoneVerified === true && profile.smsOptedIn === true
  const emailReachable = !profile.unsubscribedAt && !profile.bouncedAt
  const replies = profile.repliesCount ?? 0
  const missingCoreIdentity = !profile.jobTitle?.trim() && !profile.department?.trim() && !profile.timezone?.trim()

  return (
    <section className="bento-card !p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow !text-[10px]">Identity intelligence</p>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
            Role, timezone, and channel signals for personal follow-up.
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl leading-none text-[var(--color-pib-text)]">{health}%</p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">complete</p>
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
        <div
          className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all duration-500"
          style={{ width: `${health}%` }}
        />
      </div>

      {missingCoreIdentity ? (
        <MissingIdentityPanel fieldActions={fieldActions} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Role" value={profile.jobTitle} action={fieldActions?.jobTitle} />
          <Field label="Department" value={profile.department} action={fieldActions?.department} />
          <Field label="Timezone" value={profile.timezone} action={fieldActions?.timezone} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Signal icon="sms" label={smsReady ? 'SMS ready' : 'SMS incomplete'} healthy={smsReady} />
        <Signal icon="mark_email_read" label={emailReachable ? 'Email reachable' : 'Email blocked'} healthy={emailReachable} />
        <Signal icon="forum" label={`${replies} repl${replies === 1 ? 'y' : 'ies'}`} healthy={replies > 0} />
      </div>
    </section>
  )
}
