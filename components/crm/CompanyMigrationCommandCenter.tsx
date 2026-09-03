import { Icon } from '@/components/studio'
'use client'

export interface CompanyMigrationMatch {
  normalizedKey: string
  contactIds: string[]
  suggestedCompanyName: string
  existingCompanyId: string | null
}

interface CompanyMigrationCommandCenterProps {
  matches: CompanyMigrationMatch[]
  selected: Record<string, boolean>
  names: Record<string, string>
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between gap-2">
        <p className="pib-label">{label}</p>
        <Icon name={icon} className="text-[var(--color-pib-text-muted)]" />
      </div>
      <p className="mt-1 text-lg leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

export function CompanyMigrationCommandCenter({ matches, selected, names }: CompanyMigrationCommandCenterProps) {
  const selectedMatches = matches.filter((match) => selected[match.normalizedKey])
  const selectedContacts = selectedMatches.reduce((sum, match) => sum + match.contactIds.length, 0)
  const existingLinks = selectedMatches.filter((match) => match.existingCompanyId).length
  const newCompanies = selectedMatches.length - existingLinks
  const namesNeedingReview = selectedMatches.filter((match) => {
    const name = names[match.normalizedKey] ?? match.suggestedCompanyName
    return !name.trim()
  }).length

  return (
    <section className="pib-surface overflow-hidden">
      <div className="pib-surface-header">
        <p className="pib-label">Migration command center</p>
        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
          Review the account cleanup before applying changes to contact records.
        </p>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Selected groups"
          value={`${selectedMatches.length}/${matches.length}`}
          sub="company-name clusters queued for this migration"
          icon="checklist"
        />
        <StatCard
          label="Contacts affected"
          value={String(selectedContacts)}
          sub="selected contact records will receive company links"
          icon="contacts"
        />
        <StatCard
          label="Create vs link"
          value={`${newCompanies} new`}
          sub={`${existingLinks} existing account${existingLinks === 1 ? '' : 's'} will be reused`}
          icon="hub"
        />
        <StatCard
          label="Name review"
          value={namesNeedingReview > 0 ? `Review ${namesNeedingReview} name${namesNeedingReview === 1 ? '' : 's'}` : 'Ready'}
          sub={namesNeedingReview > 0 ? 'selected groups need a company name before apply' : 'selected names are ready to apply'}
          icon={namesNeedingReview > 0 ? 'warning' : 'verified'}
        />
      </div>
    </section>
  )
}
