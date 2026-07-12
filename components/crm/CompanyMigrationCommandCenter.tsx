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
    <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">{label}</p>
        <span className="material-symbols-outlined text-[15px] text-on-surface-variant">{icon}</span>
      </div>
      <p className="mt-1 text-lg font-semibold leading-none text-on-surface">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-on-surface-variant">{sub}</p>
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
    <section className="overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      <div className="border-b border-[var(--color-card-border)] px-3 py-2">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Migration command center</p>
        <p className="mt-1 text-xs text-on-surface-variant">
          Review the account cleanup before applying changes to contact records.
        </p>
      </div>
      <div className="grid gap-2 p-2 md:grid-cols-2 xl:grid-cols-4">
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
