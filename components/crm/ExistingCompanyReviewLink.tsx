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
      className="inline-flex h-7 max-w-[220px] items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
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
