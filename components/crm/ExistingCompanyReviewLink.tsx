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
      className="pib-pill pib-pill-accent h-7 max-w-[220px] font-medium transition-colors hover:bg-primary/15"
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
