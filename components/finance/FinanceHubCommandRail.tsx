'use client'

import Link from 'next/link'
import { Icon, Title } from '@/components/studio'
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
    { title: 'Cash & bank', detail: `${formatHubMoney(snapshot.cashMinor, snapshot.currency)} across ${snapshot.cashAccountCount} accounts`, href: '/portal/finance/documents', cta: 'Open documents & bank', icon: 'account_balance_wallet' },
    { title: 'AR / AP aging', detail: `AR ${formatHubMoney(snapshot.arOutstandingMinor, snapshot.currency)} · AP ${formatHubMoney(snapshot.apOutstandingMinor, snapshot.currency)}`, href: '/portal/finance/documents', cta: 'Work open items', icon: 'hourglass_bottom' },
    { title: 'Accounting periods', detail: `${snapshot.openPeriodCount} open / ${snapshot.periodCount} total`, href: '/portal/finance/ledger', cta: 'Open ledger periods', icon: 'calendar_month' },
    { title: 'Payroll queue', detail: `${snapshot.payrollRunsInReview} in review · ${snapshot.payrollRunsLocked} locked`, href: '/portal/finance/payroll', cta: 'Open payroll', icon: 'groups' },
    { title: 'Tax returns', detail: `${snapshot.taxReturnsReady} ready · ${snapshot.taxReturnsDraft} draft`, href: '/portal/finance/tax', cta: 'Open tax workbench', icon: 'percent' },
    { title: 'Packaging exports', detail: `${snapshot.packagingReady} ready packs · ${snapshot.packagingTotal} total (download only)`, href: '/portal/finance/packaging', cta: 'Open packaging', icon: 'inventory_2' },
  ]

  return (
    <Surface variant="list" className="overflow-hidden" data-testid="finance-hub-command-rail">
      <div className="border-b border-[var(--sc-line)] px-4 py-3">
        <p className="sc-tiny mb-0 text-[var(--sc-ink-soft)]">Finance operating rail</p>
      </div>
      <div className="grid divide-y divide-[var(--sc-line)] md:grid-cols-2 xl:grid-cols-3 md:divide-y-0 xl:[&>*:nth-child(-n+3)]:border-b xl:[&>*:nth-child(-n+3)]:border-[var(--sc-line)] md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-child(odd)]:border-[var(--sc-line)] xl:[&>*:nth-child(3n)]:border-r-0">
        {actions.map((action) => (
          <Link
            key={action.title}
            href={scopedPortalPath(action.href, orgScope)}
            aria-label={action.cta}
            className="group flex gap-2.5 p-3 transition-colors hover:bg-[color-mix(in_srgb,var(--sc-ink)_4%,transparent)]"
          >
            <Icon name={action.icon} className="shrink-0 text-[var(--sc-ink-soft)]" />
            <span className="min-w-0">
              <Title as="h2" className="text-sm">{action.title}</Title>
              <p className="sc-body mt-0.5 text-xs leading-5 text-[var(--sc-ink-soft)]">{action.detail}</p>
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sc-ink)]">
                {action.cta}
                <Icon name="arrow_forward" />
              </p>
            </span>
          </Link>
        ))}
      </div>
    </Surface>
  )
}
