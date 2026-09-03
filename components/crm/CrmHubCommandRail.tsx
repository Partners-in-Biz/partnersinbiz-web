'use client'

import Link from 'next/link'
import { Icon } from '@/components/studio'

export interface CrmHubCommandMetric {
  openDealsCount: number
  openDealsValue: number
  weightedPipelineValue: number
  recentActivityCount: number
  topOpenDealCount: number
  lostThisMonthCount: number
}

type CrmHubHrefBuilder = (path: string) => string

function formatMoney(value: number) {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `ZAR ${value.toFixed(0)}`
  }
}

export function CrmHubCommandRail({
  metrics,
  buildHref = (path) => path,
}: {
  metrics: CrmHubCommandMetric
  buildHref?: CrmHubHrefBuilder
}) {
  const hasPipeline = metrics.openDealsCount > 0
  const actions = [
    {
      title: hasPipeline ? 'Work the active pipeline' : 'Create the first live opportunity',
      detail: hasPipeline
        ? `${metrics.openDealsCount} open deals worth ${formatMoney(metrics.openDealsValue)}`
        : 'Start with a deal so forecasts, stage movement, and next actions become real.',
      href: hasPipeline ? '/portal/deals' : '/portal/deals?create=deal',
      cta: hasPipeline ? 'Open pipeline board' : 'Open new deal',
      icon: 'view_kanban',
    },
    {
      title: 'Inspect CRM performance',
      detail: `${metrics.topOpenDealCount} top deals, ${metrics.lostThisMonthCount} monthly losses, ${formatMoney(metrics.weightedPipelineValue)} weighted forecast`,
      href: '/portal/reports/crm',
      cta: 'Open CRM reports',
      icon: 'query_stats',
    },
    {
      title: 'Tighten the operating system',
      detail: `${metrics.recentActivityCount} recent activities; review setup, fields, scoring, products, automations, and webhooks.`,
      href: '/portal/settings/crm-setup',
      cta: 'Open CRM setup',
      icon: 'tune',
    },
  ]

  return (
    <section className="pib-surface pib-surface-list overflow-hidden" data-module-accent="amber">
      <div className="pib-surface-header">
        <p className="pib-label mb-0">CRM operating rail</p>
      </div>
      <div className="grid divide-y divide-[var(--color-card-border)] lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {actions.map((action) => (
          <Link
            key={action.title}
            href={buildHref(action.href)}
            aria-label={action.cta}
            className="group flex gap-2.5 p-3 pib-enter transition-colors hover:bg-[var(--color-row-hover)]"
          >
            <span aria-hidden="true" className="shrink-0">
              <Icon name={action.icon} />
            </span>
            <span className="min-w-0">
              <h2 className="text-sm text-[var(--color-pib-text)]">{action.title}</h2>
              <p className="mt-0.5 text-xs leading-5 text-[var(--color-pib-text-muted)]">{action.detail}</p>
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent-text)]">
                {action.cta}
                <Icon name="arrow_forward" />
              </p>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
