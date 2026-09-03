import type { ReactNode } from 'react'
import Link from 'next/link'

import { Icon } from '@/components/studio'

export interface HubAction {
  label: string
  href: string
  icon: string
  description: string
  eyebrow?: string
}

export interface HubSection {
  title: string
  actions: HubAction[]
}

export interface HubPageProps {
  eyebrow: string
  title: string
  description: string
  primaryAction?: HubAction
  sections: HubSection[]
  sourceContext?: {
    sourceCompanyName?: string
    targetWorkspaceName?: string
    owner?: 'org' | 'company'
  }
  children?: ReactNode
}

export function HubPage({ eyebrow, title, description, primaryAction, sections, sourceContext, children }: HubPageProps) {
  const sourceCompanyName = sourceContext?.sourceCompanyName?.trim()
  const companyOwned = sourceContext?.owner === 'company' || Boolean(sourceCompanyName)

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="pib-page-title mt-2">{title}</h1>
          <p className="pib-page-sub mt-2">{description}</p>
        </div>
        {primaryAction && (
          <Link href={primaryAction.href} className="btn-pib-accent self-start md:self-auto">
            <Icon name={primaryAction.icon} className="text-base" />
            {primaryAction.label}
          </Link>
        )}
      </header>

      {companyOwned && sourceCompanyName && (
        <section className="pib-card border-[var(--color-pib-accent)]/40 bg-[var(--color-pib-accent-soft)]/10 p-4" aria-label="Company marketing workspace">
          <div className="flex gap-3">
            <Icon name="apartment" className="mt-0.5 text-[22px] text-[var(--color-pib-accent)]" />
            <div>
              <p className="eyebrow !text-[10px]">Company marketing</p>
              <h2 className="mt-1 text-base font-medium text-[var(--color-pib-text)]">
                {sourceCompanyName}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                This company&apos;s campaigns, accounts, and brand stay here. They do not mix with this organisation&apos;s own marketing or with Personal.
              </p>
            </div>
          </div>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="text-sm font-label font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            {section.title}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {section.actions.map((action) => (
              <Link
                key={`${section.title}-${action.href}-${action.label}`}
                href={action.href}
                className="pib-card group p-5 min-h-[148px] flex flex-col justify-between transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.03]"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <span className="w-10 h-10 rounded-lg bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)] flex items-center justify-center shrink-0">
                      <Icon name={action.icon} className="text-[22px]" />
                    </span>
                    {action.eyebrow && (
                      <span className="pill !text-[10px] !py-0.5 !px-2 shrink-0">{action.eyebrow}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-base text-[var(--color-pib-text)] leading-snug">
                      {action.label}
                    </h3>
                    <p className="text-sm text-[var(--color-pib-text-muted)] mt-1 leading-relaxed">
                      {action.description}
                    </p>
                  </div>
                </div>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-label text-[var(--color-pib-accent)]">
                  Open
                  <Icon name="arrow_forward" className="text-sm transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {children}
    </div>
  )
}
