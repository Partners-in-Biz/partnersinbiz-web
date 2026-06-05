import type { ReactNode } from 'react'

type TeamAccessMember = {
  role?: string | null
  accessScope?: string | null
}

type TeamAccessGovernancePanelProps = {
  members: TeamAccessMember[]
  canPrepareCrmInvite?: boolean
  onPrepareCrmInvite?: () => void
  className?: string
}

function pluralLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function MetricCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
      <p className="eyebrow !text-[10px]">{label}</p>
      {children}
    </div>
  )
}

export function getTeamAccessGovernanceCounts(members: TeamAccessMember[]) {
  const adminCount = members.filter((member) => member.role === 'owner' || member.role === 'admin').length
  const crmCoverageCount = members.filter((member) => member.accessScope === 'crm').length
  const reviewerCount = members.filter((member) => member.role === 'viewer' || member.accessScope === 'readonly').length

  return {
    adminCount,
    crmCoverageCount,
    reviewerCount,
    needsCrmCoverage: crmCoverageCount === 0,
  }
}

export function TeamAccessGovernancePanel({
  members,
  canPrepareCrmInvite = false,
  onPrepareCrmInvite,
  className = '',
}: TeamAccessGovernancePanelProps) {
  const { adminCount, crmCoverageCount, reviewerCount, needsCrmCoverage } = getTeamAccessGovernanceCounts(members)
  const showPrepareAction = canPrepareCrmInvite && needsCrmCoverage && onPrepareCrmInvite

  return (
    <section
      role="region"
      aria-label="Team access governance"
      className={[
        'rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.14)]',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-3">
          <span className="material-symbols-outlined mt-0.5 text-[var(--color-pib-accent)]" aria-hidden="true">admin_panel_settings</span>
          <div>
            <p className="eyebrow !text-[10px]">Access governance</p>
            <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
              {needsCrmCoverage ? 'Employee access needs CRM coverage' : 'Employee access is mapped'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
              {needsCrmCoverage
                ? 'A CEO needs at least one clearly assigned CRM or sales operator before contacts, deals, and follow-ups can scale across the team.'
                : 'CRM and sales coverage is assigned, so managers can delegate relationship work without relying on generic workspace access.'}
            </p>
          </div>
        </div>
        {showPrepareAction ? (
          <button
            type="button"
            onClick={onPrepareCrmInvite}
            className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
            aria-label="Prepare CRM sales invite"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">person_add</span>
            Prepare CRM invite
          </button>
        ) : null}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="People">
          <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">{pluralLabel(members.length, 'member')}</p>
        </MetricCard>
        <MetricCard label="Admins">
          <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">{pluralLabel(adminCount, 'admin')}</p>
        </MetricCard>
        <MetricCard label="CRM operators">
          <p className={['mt-2 font-display text-2xl', needsCrmCoverage ? 'text-amber-200' : 'text-[var(--color-pib-text)]'].join(' ')}>
            {crmCoverageCount} CRM/sales
          </p>
        </MetricCard>
        <MetricCard label="Reviewers">
          <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">{pluralLabel(reviewerCount, 'reviewer')}</p>
        </MetricCard>
      </div>
    </section>
  )
}
