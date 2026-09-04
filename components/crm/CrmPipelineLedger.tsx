'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Panel } from '@/components/studio'
import './crm-pipeline-ledger.css'

type HrefBuilder = (path: string) => string

export type CrmPipelineLedgerMetrics = {
  openDealsCount: number
  openDealsValue: number
  weightedPipelineValue: number
  wonThisMonthCount: number
  wonThisMonthValue: number
  lostThisMonthCount: number
  totalContacts: number
  newThisMonth: number
  activeLeads: number
  conversionRate: number
  convertedClients: number
}

export function weightedSharePercent(openValue: number, weightedValue: number): number {
  if (!Number.isFinite(openValue) || openValue <= 0) return 0
  if (!Number.isFinite(weightedValue) || weightedValue <= 0) return 0
  return Math.min(100, Math.round((weightedValue / openValue) * 100))
}

function formatMoney(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(0)}`
  }
}

function formatCount(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString('en-ZA')
}

function formatRate(ratio: number): string {
  const safe = Number.isFinite(ratio) ? ratio : 0
  return `${(safe * 100).toFixed(1)}%`
}

function dealWord(count: number): string {
  return count === 1 ? 'deal' : 'deals'
}

function winWord(count: number): string {
  return count === 1 ? 'win' : 'wins'
}

export function CrmPipelineLedger({
  loading = false,
  currency = 'ZAR',
  metrics,
  buildHref = (path) => path,
}: {
  loading?: boolean
  currency?: string
  metrics: CrmPipelineLedgerMetrics
  buildHref?: HrefBuilder
}) {
  const [meterReady, setMeterReady] = useState(false)
  const share = weightedSharePercent(metrics.openDealsValue, metrics.weightedPipelineValue)

  useEffect(() => {
    if (loading) {
      setMeterReady(false)
      return
    }
    const frame = window.requestAnimationFrame(() => setMeterReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [loading, share])

  if (loading) {
    return (
      <section aria-label="CRM pipeline ledger" className="crm-ledger" aria-busy="true">
        <div className="crm-ledger__hero sc-ink crm-ledger__skel pib-skeleton" />
        <div className="st-panel st-panel--flat crm-ledger__book crm-ledger__skel pib-skeleton" />
      </section>
    )
  }

  const openMoney = formatMoney(metrics.openDealsValue, currency)
  const weightedMoney = formatMoney(metrics.weightedPipelineValue, currency)
  const dealCopy =
    metrics.openDealsCount > 0
      ? `${formatCount(metrics.openDealsCount)} active ${dealWord(metrics.openDealsCount)}`
      : 'No active deals'

  return (
    <section aria-label="CRM pipeline ledger" className="crm-ledger">
      <article className="crm-ledger__hero sc-ink">
        <Link
          href={buildHref('/portal/deals')}
          className="crm-ledger__price-link"
          aria-label={`Open pipeline ${openMoney}, ${dealCopy}`}
        >
          <p className="sc-tiny crm-ledger__kicker">Open pipeline</p>
          <p className="st-num crm-ledger__price">{openMoney}</p>
          <p className="sc-body crm-ledger__dek">{dealCopy}</p>
        </Link>

        <Link
          href={buildHref('/portal/deals?view=forecast')}
          className="crm-ledger__meter-link"
          aria-label={`Weighted forecast ${weightedMoney}, ${share} percent of open pipeline`}
        >
          <span
            className="crm-ledger__meter"
            role="img"
            aria-hidden="true"
          >
            <span
              className="crm-ledger__meter-fill"
              data-ready={meterReady ? 'true' : 'false'}
              style={{ width: meterReady ? `${share}%` : 0 }}
            />
          </span>
          <span className="crm-ledger__meter-meta">
            <span className="sc-tiny">Weighted forecast</span>
            <span className="st-num crm-ledger__meter-value">
              {weightedMoney} · {share}% of open
            </span>
          </span>
        </Link>
      </article>

      <Panel flat className="crm-ledger__book" as="div">
        <Link
          href={buildHref('/portal/deals?view=list')}
          className="crm-ledger__row"
          data-tone={metrics.wonThisMonthCount > 0 ? 'success' : undefined}
          aria-label={`Won this month ${formatMoney(metrics.wonThisMonthValue, currency)}`}
        >
          <span>
            <span className="sc-tiny">Won this month</span>
            <span className="crm-ledger__row-detail">
              {formatCount(metrics.wonThisMonthCount)} closed {winWord(metrics.wonThisMonthCount)}
            </span>
          </span>
          <span className="st-num crm-ledger__row-value">
            {formatMoney(metrics.wonThisMonthValue, currency)}
          </span>
        </Link>

        <Link
          href={buildHref('/portal/deals?view=list&stage=lost')}
          className="crm-ledger__row"
          data-tone={metrics.lostThisMonthCount > 0 ? 'danger' : undefined}
          aria-label={`Lost this month ${formatCount(metrics.lostThisMonthCount)}`}
        >
          <span>
            <span className="sc-tiny">Lost this month</span>
            <span className="crm-ledger__row-detail">
              {metrics.lostThisMonthCount > 0 ? 'Review loss reasons' : 'No losses logged'}
            </span>
          </span>
          <span className="st-num crm-ledger__row-value">{formatCount(metrics.lostThisMonthCount)}</span>
        </Link>

        <Link
          href={buildHref('/portal/contacts')}
          className="crm-ledger__row"
          aria-label={`Total contacts ${formatCount(metrics.totalContacts)}`}
        >
          <span>
            <span className="sc-tiny">Total contacts</span>
            <span className="crm-ledger__row-detail">People in this workspace</span>
          </span>
          <span className="st-num crm-ledger__row-value">{formatCount(metrics.totalContacts)}</span>
        </Link>

        <Link
          href={buildHref('/portal/contacts')}
          className="crm-ledger__row"
          aria-label={`New this month ${formatCount(metrics.newThisMonth)}`}
        >
          <span>
            <span className="sc-tiny">New this month</span>
            <span className="crm-ledger__row-detail">Contacts created this month</span>
          </span>
          <span className="st-num crm-ledger__row-value">{formatCount(metrics.newThisMonth)}</span>
        </Link>

        <Link
          href={buildHref('/portal/contacts')}
          className="crm-ledger__row"
          aria-label={`Active leads ${formatCount(metrics.activeLeads)}`}
        >
          <span>
            <span className="sc-tiny">Active leads</span>
            <span className="crm-ledger__row-detail">Leads still in the pipeline</span>
          </span>
          <span className="st-num crm-ledger__row-value">{formatCount(metrics.activeLeads)}</span>
        </Link>

        <Link
          href={buildHref('/portal/reports/crm')}
          className="crm-ledger__row"
          aria-label={`Conversion rate ${formatRate(metrics.conversionRate)}`}
        >
          <span>
            <span className="sc-tiny">Conversion rate</span>
            <span className="crm-ledger__row-detail">
              {formatCount(metrics.convertedClients)} converted to clients
            </span>
          </span>
          <span className="st-num crm-ledger__row-value">{formatRate(metrics.conversionRate)}</span>
        </Link>
      </Panel>
    </section>
  )
}
