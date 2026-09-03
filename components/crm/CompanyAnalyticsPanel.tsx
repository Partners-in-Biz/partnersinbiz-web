'use client'

import Link from 'next/link'
import type { CompanyTab } from '@/components/crm/CompanyTabsBar'
import { Icon } from '@/components/studio'

export type CompanyAnalyticsMetrics = {
  accountValue?: number
  weightedPipelineValue?: number
  trackedOrderValue?: number
  openProjectCount?: number
  activeServiceCount?: number
  collaborationCount?: number
  riskSignals?: string[]
}

export type CompanyAnalyticsSummary = {
  projects?: number
  serviceWorkspaces?: number
  relationships?: number
  openOrders?: number
  lowStockItems?: number
  overdueInvoices?: number
}

type OperatingAction = {
  label: string
  value: string
  icon: string
  tab: CompanyTab
  ariaLabel: string
  tone: 'risk' | 'watch' | 'good'
}

type CompanyAnalyticsPanelProps = {
  analytics?: CompanyAnalyticsMetrics
  summary?: CompanyAnalyticsSummary
  companyName: string
  hrefForTab?: (tab: CompanyTab) => string
  onOpenTab?: (tab: CompanyTab) => void
  riskClearActionHref?: string
  riskClearActionLabel?: string
  riskClearActionAriaLabel?: string
  riskClearActionIcon?: string
  riskClearBody?: string
}

function formatCurrency(value: unknown, currency = 'ZAR') {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function buildOperatingActions({
  analytics,
  summary,
  companyName,
}: {
  analytics: CompanyAnalyticsMetrics
  summary: CompanyAnalyticsSummary
  companyName: string
}): OperatingAction[] {
  const lowStockItems = summary.lowStockItems ?? 0
  const openOrders = summary.openOrders ?? 0
  const overdueInvoices = summary.overdueInvoices ?? 0
  const weightedPipelineValue = analytics.weightedPipelineValue ?? 0

  return [
    lowStockItems > 0
      ? {
          label: 'Inventory risk',
          value: `${lowStockItems} low-stock ${lowStockItems === 1 ? 'item' : 'items'}`,
          icon: 'inventory_2',
          tab: 'inventory',
          ariaLabel: `Review inventory risk for ${companyName}`,
          tone: 'risk',
        }
      : {
          label: 'Inventory coverage',
          value: 'No low-stock items',
          icon: 'inventory_2',
          tab: 'inventory',
          ariaLabel: `Review inventory coverage for ${companyName}`,
          tone: 'good',
        },
    {
      label: 'Fulfillment',
      value: openOrders > 0 ? `${openOrders} open ${openOrders === 1 ? 'order' : 'orders'}` : 'No open order blockers',
      icon: 'orders',
      tab: 'orders',
      ariaLabel: `Review fulfillment orders for ${companyName}`,
      tone: openOrders > 0 ? 'watch' : 'good',
    },
    {
      label: 'Cash collection',
      value: overdueInvoices > 0 ? `${overdueInvoices} overdue ${overdueInvoices === 1 ? 'invoice' : 'invoices'}` : 'No overdue invoices',
      icon: 'receipt_long',
      tab: 'invoices',
      ariaLabel: `Review cash collection for ${companyName}`,
      tone: overdueInvoices > 0 ? 'risk' : 'good',
    },
    {
      label: 'Pipeline',
      value: weightedPipelineValue > 0 ? `${formatCurrency(weightedPipelineValue)} weighted` : 'No weighted pipeline',
      icon: 'query_stats',
      tab: 'deals',
      ariaLabel: `Review pipeline for ${companyName}`,
      tone: weightedPipelineValue > 0 ? 'watch' : 'risk',
    },
  ]
}

const toneClass: Record<OperatingAction['tone'], string> = {
  risk: 'border-red-400/30 bg-red-500/10 text-red-200',
  watch: 'border-amber-400/30 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] text-[var(--st-warning)]',
  good: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
}

function OperatingActionControl({
  action,
  href,
  onOpenTab,
}: {
  action: OperatingAction
  href?: string
  onOpenTab?: (tab: CompanyTab) => void
}) {
  const className = `rounded-md border p-3 text-left transition-colors hover:bg-white/[0.04] ${toneClass[action.tone]}`
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-label uppercase tracking-[0.22em] opacity-80">{action.label}</span>
        <Icon name={action.icon} className="text-[16px]" />
      </div>
      <p className="mt-2 text-xs font-medium">{action.value}</p>
    </>
  )

  if (href) {
    return (
      <Link href={href} aria-label={action.ariaLabel} className={className}>
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpenTab?.(action.tab)}
      aria-label={action.ariaLabel}
      className={className}
    >
      {content}
    </button>
  )
}

export function CompanyAnalyticsPanel({
  analytics = {},
  summary = {},
  companyName,
  hrefForTab,
  onOpenTab,
  riskClearActionHref,
  riskClearActionLabel = 'Review risk records',
  riskClearActionAriaLabel,
  riskClearActionIcon = 'fact_check',
  riskClearBody,
}: CompanyAnalyticsPanelProps) {
  const tiles = [
    { label: 'Account value', value: formatCurrency(analytics.accountValue), icon: 'payments' },
    { label: 'Weighted pipeline', value: formatCurrency(analytics.weightedPipelineValue), icon: 'query_stats' },
    { label: 'Tracked orders', value: formatCurrency(analytics.trackedOrderValue), icon: 'orders' },
    { label: 'Open projects', value: String(analytics.openProjectCount ?? summary.projects ?? 0), icon: 'folder_managed' },
    { label: 'Active services', value: String(analytics.activeServiceCount ?? summary.serviceWorkspaces ?? 0), icon: 'workspaces' },
    { label: 'Collaborations', value: String(analytics.collaborationCount ?? summary.relationships ?? 0), icon: 'hub' },
  ]
  const riskSignals = analytics.riskSignals ?? []
  const operatingActions = buildOperatingActions({ analytics, summary, companyName })
  const showOperatingBrief = Boolean(hrefForTab || onOpenTab)
  const clearBody = riskClearBody
    ?? `No active risk signals are flagged for ${companyName}. Review invoices, orders, and inventory so finance, delivery, and relationship risk stay visible before the account surprises leadership.`
  const riskActionAriaLabel = riskClearActionAriaLabel ?? `Review invoices, orders, and inventory for ${companyName}`

  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      <div className="grid grid-cols-2 gap-2 border-b border-[var(--color-card-border)] p-2 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{tile.label}</p>
              <Icon name={tile.icon} className="text-[16px] text-[var(--color-pib-text-muted)]" />
            </div>
            <p className="mt-1 truncate text-lg font-medium text-[var(--color-pib-text)]">{tile.value}</p>
          </div>
        ))}
      </div>

      {showOperatingBrief ? (
        <div className="border-b border-[var(--color-card-border)] px-3 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Account operating brief</p>
              <h3 className="mt-0.5 text-sm font-medium text-[var(--color-pib-text)]">Where the team should act next</h3>
            </div>
            <span className={`pib-pill ${riskSignals.length > 0 ? 'pib-pill-warn' : ''}`}>
              {riskSignals.length > 0 ? `${riskSignals.length} active signal${riskSignals.length === 1 ? '' : 's'}` : 'No active risks'}
            </span>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {operatingActions.map((action) => (
              <OperatingActionControl
                key={action.label}
                action={action}
                href={hrefForTab?.(action.tab)}
                onOpenTab={onOpenTab}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="px-3 py-2.5">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Risk signals</p>
        {riskSignals.length === 0 ? (
          <div className="mt-2 rounded-md border border-emerald-400/20 bg-emerald-400/10 p-3">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-emerald-200">Risk watch clear</p>
            <h3 className="mt-1 text-xs font-medium text-[var(--color-pib-text)]">Keep leadership risk reviewable</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
              {clearBody}
            </p>
            {riskClearActionHref ? (
              <Link
                href={riskClearActionHref}
                aria-label={riskActionAriaLabel}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
              >
                <Icon name={riskClearActionIcon} className="text-[14px]" />
                {riskClearActionLabel}
              </Link>
            ) : onOpenTab ? (
              <button
                type="button"
                onClick={() => onOpenTab('invoices')}
                aria-label={riskActionAriaLabel}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
              >
                <Icon name={riskClearActionIcon} className="text-[14px]" />
                {riskClearActionLabel}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {riskSignals.map((signal) => (
              <span key={signal} className="pib-pill pib-pill-warn">
                {signal}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
