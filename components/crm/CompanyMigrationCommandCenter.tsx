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
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display text-3xl leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{sub}</p>
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
    <section className="pib-card-section overflow-hidden">
      <div className="border-b border-[var(--color-pib-line)] bg-white/[0.02] px-5 py-3.5">
        <p className="eyebrow">Migration command center</p>
        <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
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
