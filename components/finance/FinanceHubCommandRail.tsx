'use client'

import Link from 'next/link'
import { Surface } from '@/components/ui/AppFoundation'
import type { FinanceHubSnapshot } from '@/components/finance/financeHubMetrics'
import { formatHubMoney } from '@/components/finance/financeHubMetrics'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

export function FinanceHubCommandRail({
  snapshot,
  orgScope,
}: {
  snapshot: FinanceHubSnapshot
  orgScope: PortalOrgRouteScope
}) {
  const actions = [
    {
      title: 'Cash & bank',
      detail: `${formatHubMoney(snapshot.cashMinor, snapshot.currency)} across ${snapshot.cashAccountCount} accounts`,
      href: '/portal/finance/documents',
      cta: 'Open documents & bank',
      icon: 'account_balance_wallet',
    },
    {
      title: 'AR / AP aging',
      detail: `AR ${formatHubMoney(snapshot.arOutstandingMinor, snapshot.currency)} · AP ${formatHubMoney(snapshot.apOutstandingMinor, snapshot.currency)}`,
      href: '/portal/finance/documents',
      cta: 'Work open items',
      icon: 'hourglass_bottom',
    },
    {
      title: 'Accounting periods',
      detail: `${snapshot.openPeriodCount} open / ${snapshot.periodCount} total`,
      href: '/portal/finance/ledger',
      cta: 'Open ledger periods',
      icon: 'calendar_month',
    },
    {
      title: 'Payroll queue',
      detail: `${snapshot.payrollRunsInReview} in review · ${snapshot.payrollRunsLocked} locked`,
      href: '/portal/finance/payroll',
      cta: 'Open payroll',
      icon: 'groups',
    },
    {
      title: 'Tax returns',
      detail: `${snapshot.taxReturnsReady} ready · ${snapshot.taxReturnsDraft} draft`,
      href: '/portal/finance/tax',
      cta: 'Open tax workbench',
      icon: 'percent',
    },
    {
      title: 'Packaging exports',
      detail: `${snapshot.packagingReady} ready packs · ${snapshot.packagingTotal} total (download only)`,
      href: '/portal/finance/packaging',
      cta: 'Open packaging',
      icon: 'inventory_2',
    },
  ]

  return (
    <Surface variant="list" className="overflow-hidden" data-testid="finance-hub-command-rail" data-module-accent="amber">
      <div className="pib-surface-header">
        <p className="pib-label mb-0">Finance operating rail</p>
      </div>
      <div className="grid divide-y divide-[var(--color-card-border)] md:grid-cols-2 xl:grid-cols-3 md:divide-y-0 xl:[&>*:nth-child(-n+3)]:border-b xl:[&>*:nth-child(-n+3)]:border-[var(--color-card-border)] md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-child(odd)]:border-[var(--color-card-border)] xl:[&>*:nth-child(3n)]:border-r-0">
        {actions.map((action) => (
          <Link
            key={action.title}
            href={scopedPortalPath(action.href, orgScope)}
            aria-label={action.cta}
            className="group flex gap-2.5 p-3 pib-enter transition-colors hover:bg-[var(--color-row-hover)]"
          >
            <span aria-hidden="true" className="pib-icon-tint shrink-0">
              <span className="material-symbols-outlined text-[16px]">{action.icon}</span>
            </span>
            <span className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--color-pib-text)]">{action.title}</h2>
              <p className="mt-0.5 text-xs leading-5 text-[var(--color-pib-text-muted)]">{action.detail}</p>
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent-text)]">
                {action.cta}
                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                  arrow_forward
                </span>
              </p>
            </span>
          </Link>
        ))}
      </div>
    </Surface>
  )
}
