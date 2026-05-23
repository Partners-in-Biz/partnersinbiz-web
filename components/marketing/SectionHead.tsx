import { ReactNode } from 'react'
import Link from 'next/link'

interface Props {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  href?: string
  cta?: string
  align?: 'left' | 'center'
}

export function SectionHead({ eyebrow, title, subtitle, href, cta, align = 'left' }: Props) {
  return (
    <div className={`flex ${align === 'center' ? 'flex-col items-center text-center' : 'flex-col md:flex-row md:items-end md:justify-between'} gap-6 mb-12 md:mb-16`}>
      <div className={align === 'center' ? 'max-w-2xl' : 'max-w-2xl'}>
        {eyebrow && <p className="eyebrow mb-4">{eyebrow}</p>}
        <h2 className="h-display text-balance">{title}</h2>
        {subtitle && (
          <p className="mt-5 text-lg text-[var(--color-pib-text-muted)] max-w-xl text-pretty">
            {subtitle}
          </p>
        )}
      </div>
      {href && cta && (
        <Link href={href} prefetch={false} className="btn-pib-secondary self-start md:self-end shrink-0">
          {cta}
          <span className="material-symbols-outlined text-base">arrow_outward</span>
        </Link>
      )}
    </div>
  )
}
