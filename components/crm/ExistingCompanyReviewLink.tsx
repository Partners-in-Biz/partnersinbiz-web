import Link from 'next/link'

export function ExistingCompanyReviewLink({
  companyId,
  companyName,
  href,
}: {
  companyId: string
  companyName: string
  href?: string
}) {
  const label = companyName.trim() || 'matched company'

  return (
    <Link
      href={href ?? `/portal/companies/${companyId}`}
      className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-[var(--color-pib-line)] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-v2)] transition-colors hover:border-[var(--color-accent-v2)]/50 hover:bg-white/[0.06]"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${label}`}
      title={`Open ${label}`}
    >
      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">open_in_new</span>
      <span className="truncate">Open {label}</span>
    </Link>
  )
}
