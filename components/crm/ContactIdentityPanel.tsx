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

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">{label}</p>
      <p className="mt-1 text-sm text-[var(--color-pib-text)]">{value || 'Not captured'}</p>
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

export function ContactIdentityPanel({ profile }: { profile: ContactIdentityProfile }) {
  const health = contactIdentityHealth(profile)
  const smsReady = profile.phoneVerified === true && profile.smsOptedIn === true
  const emailReachable = !profile.unsubscribedAt && !profile.bouncedAt
  const replies = profile.repliesCount ?? 0

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

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Role" value={profile.jobTitle} />
        <Field label="Department" value={profile.department} />
        <Field label="Timezone" value={profile.timezone} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Signal icon="sms" label={smsReady ? 'SMS ready' : 'SMS incomplete'} healthy={smsReady} />
        <Signal icon="mark_email_read" label={emailReachable ? 'Email reachable' : 'Email blocked'} healthy={emailReachable} />
        <Signal icon="forum" label={`${replies} repl${replies === 1 ? 'y' : 'ies'}`} healthy={replies > 0} />
      </div>
    </section>
  )
}
