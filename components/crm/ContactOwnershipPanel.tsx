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

function memberLabel(ref?: MemberRef, fallback?: string): string {
  return ref?.displayName || fallback || 'Unassigned'
}

function memberMeta(ref?: MemberRef): string {
  if (!ref) return 'No team snapshot yet'
  return [ref.jobTitle, ref.kind].filter(Boolean).join(' · ') || ref.uid
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
  actions?: {
    assignOwner?: {
      label: string
      ariaLabel: string
      onClick: () => void
    }
  }
}) {
  const health = contactOwnershipHealth(profile)
  const owner = memberLabel(profile.assignedToRef, profile.assignedTo)
  const needsOwner = !profile.assignedToRef?.displayName && !profile.assignedTo
  const source = profile.source || 'Not captured'
  const captureSource = profile.capturedFromId || 'Manual or legacy record'
  const creator = memberLabel(profile.createdByRef, undefined)
  const updater = memberLabel(profile.updatedByRef, undefined)

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
        <Field
          icon="supervisor_account"
          label="Owner"
          value={owner}
          meta={memberMeta(profile.assignedToRef)}
          action={needsOwner && actions?.assignOwner ? { ...actions.assignOwner, icon: 'person_add' } : undefined}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Field icon="conversion_path" label="Source" value={source} />
          <Field icon="fingerprint" label="Capture source" value={captureSource} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field icon="person_add" label="Created by" value={creator} meta={memberMeta(profile.createdByRef)} />
          <Field icon="manage_accounts" label="Updated by" value={updater} meta={memberMeta(profile.updatedByRef)} />
        </div>
      </div>
    </section>
  )
}
