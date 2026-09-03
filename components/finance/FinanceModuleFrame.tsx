'use client'

import type { ComponentProps, ReactNode } from 'react'
import Link from 'next/link'
import { ModuleShell } from '@/components/ui/ModuleShell'
import { EmptyState, PageHeader, PageLinkTabs, Surface } from '@/components/ui/AppFoundation'
import { Button } from '@/components/ui/Button'
import { ButtonLink, Icon, Notice, Skeleton, Status } from '@/components/studio'
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
    <ModuleShell tier={1} shellTestId="finance-module-shell" className="min-h-0" data-finance-route={active}>
      <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col space-y-4">
        <PageHeader
          eyebrow="Finance command centre"
          title={title ?? activeItem.label}
          description={description ?? activeItem.description}
          meta={
            meta ?? (
              <div className="flex flex-wrap items-center gap-2">
                <Status>No SARS submit</Status>
                <Status>No external payment initiate</Status>
                <Status tone="info">Tenant scoped</Status>
              </div>
            )
          }
          actions={
            actions ?? (
              <div className="flex flex-wrap items-center gap-2">
                <ButtonLink href={scopedPortalPath('/portal/billing', orgScope)} variant="ghost" size="sm">
                  Billing hub
                </ButtonLink>
                <ButtonLink href={scopedPortalPath('/portal/invoicing', orgScope)} variant="ghost" size="sm">
                  Invoicing
                </ButtonLink>
                <ButtonLink href={scopedPortalPath('/portal/payments', orgScope)} variant="secondary" size="sm">
                  Payments
                </ButtonLink>
              </div>
            )
          }
          tabs={<PageLinkTabs ariaLabel="Finance module sections" activeValue={active} tabs={tabs} />}
        />

        {error ? (
          <div data-testid="finance-error">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : null}
        {message ? (
          <div data-testid="finance-message">
            <Notice tone="info">{message}</Notice>
          </div>
        ) : null}

        {moreLinks.length > 0 ? (
          <Surface variant="list" bodyClassName="!p-0" data-testid="finance-secondary-nav">
            <div className="flex flex-wrap gap-2 p-2">
              {moreLinks.map((item) => {
                const href = scopedPortalPath(item.href, orgScope)
                const selected = item.key === active
                return (
                  <Link
                    key={item.key}
                    href={href}
                    className={selected ? 'st-btn st-btn--secondary st-btn--sm' : 'st-btn st-btn--ghost st-btn--sm'}
                    aria-current={selected ? 'page' : undefined}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </Surface>
        ) : null}

        {loading ? (
          <Surface className="space-y-3 p-5" data-testid="finance-loading">
            <Skeleton height="1.25rem" width="40%" />
            <Skeleton height="6rem" />
            <p className="sc-body text-[var(--sc-ink-soft)]">Loading finance workspace.</p>
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
    <div data-testid="finance-empty-scope">
      <EmptyState
        title="Select or bootstrap a book."
        description="Finance commands need an organisation, legal entity, and book scope. Bootstrap from the command centre or setup guide."
        action={(
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={onBootstrapHref || scopedPortalPath('/portal/finance', orgScope)} size="sm">
              Open command centre
            </ButtonLink>
            <ButtonLink href={scopedPortalPath('/portal/finance/setup', orgScope)} variant="ghost" size="sm">
              Setup guide
            </ButtonLink>
          </div>
        )}
      />
    </div>
  )
}

export function FinancePrimaryButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button variant="primary" size="sm" {...props}>
      {children}
    </Button>
  )
}
