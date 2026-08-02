'use client'

import type { ComponentProps, ReactNode } from 'react'
import Link from 'next/link'
import { ModuleShell } from '@/components/ui/ModuleShell'
import { PageHeader, PageLinkTabs, Surface } from '@/components/ui/AppFoundation'
import { HudChip } from '@/components/ui/HudChip'
import { Button } from '@/components/ui/Button'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import {
  FINANCE_NAV,
  FINANCE_PRIMARY_TABS,
  type FinanceRouteKey,
  financeNavItem,
} from '@/components/finance/financeRoutes'

type FinanceModuleFrameProps = {
  active: FinanceRouteKey
  orgScope: PortalOrgRouteScope
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  error?: string | null
  message?: string | null
  loading?: boolean
  children: ReactNode
}

export function FinanceModuleFrame({
  active,
  orgScope,
  title,
  description,
  actions,
  meta,
  error,
  message,
  loading,
  children,
}: FinanceModuleFrameProps) {
  const activeItem = financeNavItem(active)
  const tabs = FINANCE_PRIMARY_TABS.map((key) => {
    const item = financeNavItem(key)
    return {
      label: item.label,
      value: item.key,
      href: scopedPortalPath(item.href, orgScope),
      icon: item.icon,
    }
  })

  const moreLinks = FINANCE_NAV.filter((item) => !FINANCE_PRIMARY_TABS.includes(item.key))

  return (
    <ModuleShell
      tier={1}
      accent="amber"
      shellTestId="finance-module-shell"
      className="min-h-0"
      data-finance-route={active}
    >
      <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col space-y-4" data-module-accent="amber">
        <PageHeader
          accent="amber"
          eyebrow="Finance command centre"
          title={title ?? activeItem.label}
          description={description ?? activeItem.description}
          meta={
            meta ?? (
              <div className="flex flex-wrap items-center gap-1.5">
                <HudChip tone="accent">No SARS submit</HudChip>
                <HudChip>No external payment initiate</HudChip>
                <HudChip>Tenant scoped</HudChip>
              </div>
            )
          }
          actions={
            actions ?? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={scopedPortalPath('/portal/billing', orgScope)} className="pib-btn-ghost btn-pib-sm">
                  Billing hub
                </Link>
                <Link href={scopedPortalPath('/portal/invoicing', orgScope)} className="pib-btn-ghost btn-pib-sm">
                  Invoicing
                </Link>
                <Link href={scopedPortalPath('/portal/payments', orgScope)} className="pib-btn-secondary btn-pib-sm">
                  Payments
                </Link>
              </div>
            )
          }
          tabs={
            <PageLinkTabs
              ariaLabel="Finance module sections"
              activeValue={active}
              tabs={tabs}
              variant="segmented"
            />
          }
        />

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-100"
            data-testid="finance-error"
          >
            {error}
          </div>
        ) : null}
        {message ? (
          <div
            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"
            data-testid="finance-message"
          >
            {message}
          </div>
        ) : null}

        {moreLinks.length > 0 ? (
          <Surface variant="list" bodyClassName="!p-0" data-testid="finance-secondary-nav">
            <div className="flex flex-wrap gap-1.5 p-2">
              {moreLinks.map((item) => {
                const href = scopedPortalPath(item.href, orgScope)
                const selected = item.key === active
                return (
                  <Link
                    key={item.key}
                    href={href}
                    className={selected ? 'pib-btn-secondary btn-pib-sm' : 'pib-btn-ghost btn-pib-sm'}
                    aria-current={selected ? 'page' : undefined}
                  >
                    <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </Surface>
        ) : null}

        {loading ? (
          <Surface className="p-6 text-sm text-[var(--color-pib-text-muted)]" data-testid="finance-loading">
            Loading finance workspace…
          </Surface>
        ) : (
          children
        )}
      </div>
    </ModuleShell>
  )
}

export function FinanceEmptyScope({
  orgScope,
  onBootstrapHref,
}: {
  orgScope: PortalOrgRouteScope
  onBootstrapHref?: string
}) {
  return (
    <Surface className="space-y-3 p-5" data-testid="finance-empty-scope">
      <h2 className="text-base font-semibold text-[var(--color-pib-text)]">Select or bootstrap a book</h2>
      <p className="text-sm text-[var(--color-pib-text-muted)]">
        Finance commands need an organisation, legal entity, and book scope. Bootstrap from the command centre or setup guide.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={onBootstrapHref || scopedPortalPath('/portal/finance', orgScope)} className="pib-btn-primary btn-pib-sm">
          Open command centre
        </Link>
        <Link href={scopedPortalPath('/portal/finance/setup', orgScope)} className="pib-btn-ghost btn-pib-sm">
          Setup guide
        </Link>
      </div>
    </Surface>
  )
}

/** Small helper for pages that still need a plain primary action button. */
export function FinancePrimaryButton(props: ComponentProps<typeof Button>) {
  return <Button variant="primary" size="sm" {...props} />
}
