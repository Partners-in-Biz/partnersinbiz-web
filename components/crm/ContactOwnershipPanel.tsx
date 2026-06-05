'use client'

import type { MemberRef } from '@/lib/orgMembers/memberRef'

export interface ContactOwnershipProfile {
  assignedTo?: string
  assignedToRef?: MemberRef
  source?: string
  capturedFromId?: string
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
}

export interface ContactOwnershipActions {
  assignOwner?: {
    label: string
    ariaLabel: string
    onClick: () => void
  }
  reviewSource?: {
    label: string
    ariaLabel: string
    onClick: () => void
  }
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual entry',
  form: 'Form capture',
  import: 'Imported list',
  outreach: 'Outreach',
}

const MEMBER_KIND_LABELS: Record<string, string> = {
  human: 'Team member',
  agent: 'AI agent',
}

function memberLabel(ref?: MemberRef, fallback?: string): string {
  if (ref?.displayName) return ref.displayName
  if (ref || fallback) return 'Owner identity missing'
  return 'Unassigned'
}

function auditActorLabel(ref: MemberRef | undefined, missingLabel: string): string {
  if (!ref) return missingLabel
  if (ref.displayName) return ref.displayName
  return missingLabel.replace('not captured', 'identity missing')
}

function sourceLabel(source?: string): string {
  const key = source?.trim() ?? ''
  if (!key) return 'Not captured'
  return SOURCE_LABELS[key] ?? readableSourceFallback(key)
}

function readableSourceFallback(source: string): string {
  return readableTokenLabel(source)
}

function captureSourceLabel(capturedFromId?: string): string {
  const key = capturedFromId?.trim()
  if (!key) return 'Manual or legacy record'
  return readableTokenLabel(key)
}

function readableTokenLabel(value: string): string {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function memberMeta(ref?: MemberRef): string {
  if (!ref) return 'No team snapshot yet'
  const kind = ref.kind ? MEMBER_KIND_LABELS[ref.kind] ?? readableTokenLabel(ref.kind) : undefined
  return [ref.jobTitle, kind].filter(Boolean).join(' · ') || 'Team snapshot details not captured'
}

function Field({
  icon,
  label,
  value,
  meta,
  action,
}: {
  icon: string
  label: string
  value: string
  meta?: string
  action?: {
    label: string
    ariaLabel: string
    icon: string
    onClick: () => void
  }
}) {
  return (
    <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.025] p-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-pib-accent)]">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">{label}</p>
          <p className="mt-1 break-words text-sm font-medium text-[var(--color-pib-text)]">{value}</p>
          {meta ? <p className="mt-1 break-words text-[11px] text-[var(--color-pib-text-muted)]">{meta}</p> : null}
          {action ? (
            <button
              type="button"
              aria-label={action.ariaLabel}
              onClick={action.onClick}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
            >
              <span className="material-symbols-outlined text-[13px]" aria-hidden="true">{action.icon}</span>
              {action.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function MissingOwnerPanel({
  action,
}: {
  action?: {
    label: string
    ariaLabel: string
    onClick: () => void
  }
}) {
  return (
    <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.025] p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[18px] text-[var(--color-pib-accent)]"
        >
          person_alert
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            Owner accountability missing
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Assign a relationship owner</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
            No team member owns this contact yet. Assign an owner so follow-ups, handoffs, and pipeline accountability are visible before the relationship goes cold.
          </p>
          {action ? (
            <button
              type="button"
              aria-label={action.ariaLabel}
              onClick={action.onClick}
              className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">person_add</span>
              {action.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function WeakSourcePanel({
  action,
}: {
  action?: {
    label: string
    ariaLabel: string
    onClick: () => void
  }
}) {
  return (
    <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.025] p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[18px] text-[var(--color-pib-accent)]"
        >
          conversion_path
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            Source provenance weak
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Confirm how this contact entered CRM</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
            This relationship is marked as manual or legacy without a capture source. Review the source so attribution, segment reporting, and follow-up ownership stay trustworthy.
          </p>
          {action ? (
            <button
              type="button"
              aria-label={action.ariaLabel}
              onClick={action.onClick}
              className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">edit</span>
              {action.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function contactOwnershipHealth(profile: ContactOwnershipProfile): number {
  const checks = [
    Boolean(profile.assignedToRef?.displayName || profile.assignedTo),
    Boolean(profile.source?.trim()),
    Boolean(profile.capturedFromId?.trim()),
    Boolean(profile.createdByRef?.displayName || profile.createdByRef?.uid),
    Boolean(profile.updatedByRef?.displayName || profile.updatedByRef?.uid),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export function ContactOwnershipPanel({
  profile,
  actions,
}: {
  profile: ContactOwnershipProfile
  actions?: ContactOwnershipActions
}) {
  const health = contactOwnershipHealth(profile)
  const owner = memberLabel(profile.assignedToRef, profile.assignedTo)
  const needsOwner = !profile.assignedToRef?.displayName && !profile.assignedTo
  const weakSource = !profile.capturedFromId?.trim() && (!profile.source?.trim() || profile.source === 'manual')
  const source = sourceLabel(profile.source)
  const captureSource = captureSourceLabel(profile.capturedFromId)
  const creator = auditActorLabel(profile.createdByRef, 'Creator not captured')
  const updater = auditActorLabel(profile.updatedByRef, 'Updater not captured')

  return (
    <section className="bento-card !p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow !text-[10px]">Relationship ownership</p>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
            Team accountability, source provenance, and last governance snapshot.
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl leading-none text-[var(--color-pib-text)]">{health}%</p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">governed</p>
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
        <div
          className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all duration-500"
          style={{ width: `${health}%` }}
        />
      </div>

      <div className="space-y-2">
        {needsOwner ? (
          <MissingOwnerPanel action={actions?.assignOwner} />
        ) : (
          <Field
            icon="supervisor_account"
            label="Owner"
            value={owner}
            meta={memberMeta(profile.assignedToRef)}
          />
        )}
        {weakSource ? (
          <WeakSourcePanel action={actions?.reviewSource} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field icon="conversion_path" label="Source" value={source} />
            <Field icon="fingerprint" label="Capture source" value={captureSource} />
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Field icon="person_add" label="Created by" value={creator} meta={memberMeta(profile.createdByRef)} />
          <Field icon="manage_accounts" label="Updated by" value={updater} meta={memberMeta(profile.updatedByRef)} />
        </div>
      </div>
    </section>
  )
}
