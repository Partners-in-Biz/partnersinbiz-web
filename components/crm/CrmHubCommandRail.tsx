'use client'

import Link from 'next/link'

export interface CrmHubCommandMetric {
  openDealsCount: number
  openDealsValue: number
  weightedPipelineValue: number
  recentActivityCount: number
  topOpenDealCount: number
  lostThisMonthCount: number
}

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

export function CrmHubCommandRail({ metrics }: { metrics: CrmHubCommandMetric }) {
  const hasPipeline = metrics.openDealsCount > 0
  const actions = [
    {
      title: hasPipeline ? 'Work the active pipeline' : 'Create the first live opportunity',
      detail: hasPipeline
        ? `${metrics.openDealsCount} open deals worth ${formatMoney(metrics.openDealsValue)}`
        : 'Start with a deal so forecasts, stage movement, and next actions become real.',
      href: '/portal/deals',
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
    <section className="pib-card-section overflow-hidden">
      <div className="border-b border-[var(--color-pib-line)] bg-white/[0.02] px-5 py-3.5">
        <p className="eyebrow !text-[10px]">CRM operating rail</p>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {actions.map((action) => (
          <Link
            key={action.title}
            href={action.href}
            aria-label={action.cta}
            className="group rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4 transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.05]"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                <span className="material-symbols-outlined text-[20px]">{action.icon}</span>
              </span>
              <span className="material-symbols-outlined text-sm text-[var(--color-pib-text-muted)] transition-transform group-hover:translate-x-0.5">arrow_forward</span>
            </div>
            <h2 className="mt-4 text-base font-display text-[var(--color-pib-text)]">{action.title}</h2>
            <p className="mt-2 min-h-[42px] text-sm leading-6 text-[var(--color-pib-text-muted)]">{action.detail}</p>
            <p className="mt-4 text-xs font-label text-[var(--color-pib-accent)]">{action.cta}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
