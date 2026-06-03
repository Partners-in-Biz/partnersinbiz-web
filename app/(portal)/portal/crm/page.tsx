'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CrmHubCommandRail } from '@/components/crm/CrmHubCommandRail'
import type { HubSection } from '@/components/navigation/HubPage'
import type { Deal } from '@/lib/crm/types'

type CrmDashboard = {
  openDealsCount?: number
  openDealsValue?: number
  weightedPipelineValue?: number
  wonThisMonth?: { count?: number; value?: number }
  lostThisMonth?: { count?: number }
  recentActivities?: Array<{ id: string; type?: string; summary?: string; contactName?: string; contactId?: string; dealId?: string; createdAt?: unknown }>
  topOpenDeals?: Array<Deal & { contactName?: string }>
}

type CrmLeadershipRisk = {
  label: string
  description: string
  href: string
  icon: string
  actionLabel: string
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  email_sent: 'Email sent',
  email_received: 'Email received',
  call: 'Call',
  note: 'Note',
  sms_sent: 'SMS sent',
  meeting_scheduled: 'Meeting scheduled',
  stage_change: 'Stage changed',
  sequence_enrolled: 'Enrolled in sequence',
  sequence_completed: 'Sequence completed',
  contact_captured: 'Contact captured',
}

const SECTIONS: HubSection[] = [
  {
    title: 'Sales workspace',
    actions: [
      {
        label: 'Contacts',
        href: '/portal/contacts',
        icon: 'contacts',
        description: 'People, scores, tags, notes, emails, sequences, and follow-up history.',
        eyebrow: 'People',
      },
      {
        label: 'Companies',
        href: '/portal/companies',
        icon: 'domain',
        description: 'Accounts, health, contacts, deals, relationships, projects, and business activity.',
        eyebrow: 'Accounts',
      },
      {
        label: 'Deals',
        href: '/portal/deals',
        icon: 'monetization_on',
        description: 'Pipeline board, forecast, line items, stage movement, and close discipline.',
        eyebrow: 'Pipeline',
      },
      {
        label: 'CRM reports',
        href: '/portal/reports/crm',
        icon: 'query_stats',
        description: 'Funnel, forecast, velocity, activity, and rep performance analytics.',
        eyebrow: 'Reports',
      },
    ],
  },
  {
    title: 'Capture and communication',
    actions: [
      {
        label: 'Segments',
        href: '/portal/segments',
        icon: 'group_work',
        description: 'Audience groups for campaigns, nurture, and client follow-up.',
        eyebrow: 'Audience',
      },
      {
        label: 'Capture sources',
        href: '/portal/capture-sources',
        icon: 'inventory_2',
        description: 'Forms, imports, and public lead capture surfaces.',
        eyebrow: 'Leads',
      },
      {
        label: 'Integrations',
        href: '/portal/integrations',
        icon: 'extension',
        description: 'Connected CRM sources like Gmail, HubSpot, Mailchimp, and related systems.',
        eyebrow: 'Systems',
      },
      {
        label: 'Email',
        href: '/portal/email',
        icon: 'mail',
        description: 'Workspace mailbox with CRM communication context.',
        eyebrow: 'Inbox',
      },
    ],
  },
  {
    title: 'Configuration',
    actions: [
      {
        label: 'CRM setup',
        href: '/portal/settings/crm-setup',
        icon: 'rocket_launch',
        description: 'Starter templates and workspace setup checks.',
        eyebrow: 'Start',
      },
      {
        label: 'Pipelines',
        href: '/portal/settings/pipelines',
        icon: 'sync_alt',
        description: 'Deal stages, probabilities, and default pipeline rules.',
        eyebrow: 'Stages',
      },
      {
        label: 'Custom fields',
        href: '/portal/settings/custom-fields',
        icon: 'tune',
        description: 'Extra fields for contacts, companies, and deals.',
        eyebrow: 'Fields',
      },
      {
        label: 'Scoring',
        href: '/portal/settings/scoring',
        icon: 'star_rate',
        description: 'ICP, lead-score weights, and AI lead scoring.',
        eyebrow: 'AI',
      },
      {
        label: 'Products',
        href: '/portal/settings/products',
        icon: 'inventory',
        description: 'Products used for deal line items and quote conversion.',
        eyebrow: 'Catalog',
      },
      {
        label: 'Automations',
        href: '/portal/settings/automations',
        icon: 'bolt',
        description: 'Notifications, assignments, webhooks, and sequences from CRM events.',
        eyebrow: 'Rules',
      },
      {
        label: 'Sequences',
        href: '/portal/settings/sequences',
        icon: 'route',
        description: 'Nurture and follow-up sequences for contacts.',
        eyebrow: 'Follow-up',
      },
      {
        label: 'Webhooks',
        href: '/portal/settings/webhooks',
        icon: 'webhook',
        description: 'Signed outbound CRM events for external systems.',
        eyebrow: 'Events',
      },
    ],
  },
]

function formatCurrency(value: unknown, currency = 'ZAR'): string {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
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

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function timestampMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: number; _seconds?: number; toDate?: () => Date; toMillis?: () => number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function hasUnreadableTimestamp(value: unknown): boolean {
  if (!value) return false
  if (value instanceof Date) return Number.isNaN(value.getTime())
  if (typeof value === 'string') return Number.isNaN(Date.parse(value))
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: unknown; _seconds?: unknown; toDate?: () => Date; toMillis?: () => number }
    if (typeof timestamp.toMillis === 'function') return !Number.isFinite(timestamp.toMillis())
    if (typeof timestamp.toDate === 'function') return Number.isNaN(timestamp.toDate().getTime())
    const seconds = timestamp.seconds ?? timestamp._seconds
    return seconds !== undefined && (typeof seconds !== 'number' || !Number.isFinite(seconds))
  }
  return true
}

function formatRelative(value: unknown): string {
  const ms = timestampMs(value)
  if (!ms) return hasUnreadableTimestamp(value) ? 'Activity date needs review' : 'Timestamp not captured'
  const diffDays = Math.round((Date.now() - ms) / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 30) return `${diffDays}d ago`
  return new Date(ms).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

function textValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function readableActivityType(value: unknown): string {
  const key = textValue(value)
  if (!key) return 'CRM activity'
  const fallback = key.replace(/[_-]+/g, ' ').trim()
  return ACTIVITY_TYPE_LABELS[key] ?? (fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : 'CRM activity')
}

function hubActionLabel(label: string): string {
  return label.toLowerCase().startsWith('crm ')
    ? `Open ${label} workspace`
    : `Open ${label} CRM workspace`
}

function activitySummary(activity: NonNullable<CrmDashboard['recentActivities']>[number]): string {
  return textValue(activity.summary) || readableActivityType(activity.type)
}

function activityContactLabel(value: unknown): string {
  return textValue(value) || 'Contact not linked'
}

function activityHref(activity: NonNullable<CrmDashboard['recentActivities']>[number]): string {
  const dealId = textValue(activity.dealId)
  if (dealId) return `/portal/deals/${encodeURIComponent(dealId)}`
  const contactId = textValue(activity.contactId)
  return contactId ? `/portal/contacts/${encodeURIComponent(contactId)}` : ''
}

function buildLeadershipRisks(dashboard: CrmDashboard | null): CrmLeadershipRisk[] {
  if (!dashboard) return []
  const risks: CrmLeadershipRisk[] = []
  const openDealsCount = numberValue(dashboard.openDealsCount)
  const openDealsValue = numberValue(dashboard.openDealsValue)
  const weightedPipelineValue = numberValue(dashboard.weightedPipelineValue)
  const recentActivityCount = dashboard.recentActivities?.length ?? 0
  const lostThisMonthCount = numberValue(dashboard.lostThisMonth?.count)
  const topDeal = dashboard.topOpenDeals?.[0]

  if (openDealsValue > 0 && weightedPipelineValue <= 0) {
    risks.push({
      label: 'Forecast confidence missing',
      description: 'Open deal value exists, but probability-weighted forecast is still zero.',
      href: '/portal/deals?view=forecast',
      icon: 'query_stats',
      actionLabel: 'Open forecast view',
    })
  }

  if (openDealsCount > 0 && recentActivityCount === 0) {
    risks.push({
      label: 'Relationship activity quiet',
      description: 'Active pipeline has no recent contact movement for managers to review.',
      href: '/portal/contacts?followUp=stale',
      icon: 'phone_in_talk',
      actionLabel: 'Open stale follow-up view',
    })
  }

  if (lostThisMonthCount > 0) {
    risks.push({
      label: `${lostThisMonthCount} lost ${lostThisMonthCount === 1 ? 'deal' : 'deals'} this month`,
      description: 'Review loss reasons before the same objections repeat across the team.',
      href: '/portal/deals?view=list&stage=lost',
      icon: 'report',
      actionLabel: 'Open lost deals view',
    })
  }

  if (topDeal && numberValue(topDeal.value) <= 0) {
    risks.push({
      label: 'Top deal needs value',
      description: 'The highest-priority open deal is missing commercial weight.',
      href: `/portal/deals/${encodeURIComponent(topDeal.id)}`,
      icon: 'price_check',
      actionLabel: 'Open top deal',
    })
  }

  return risks
}

function DashboardMetric({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub: string
  icon: string
}) {
  return (
    <div className="pib-card min-h-[126px] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]" aria-hidden="true">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-display leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

function CrmLeadershipRiskBrief({ risks }: { risks: CrmLeadershipRisk[] }) {
  if (!risks.length) return null
  const riskCopy = `${risks.length} CRM ${risks.length === 1 ? 'risk needs' : 'risks need'} leadership attention before this workspace is board-ready.`

  return (
    <section className="pib-card-section overflow-hidden">
      <div className="grid gap-5 border-b border-[var(--color-pib-line)] bg-white/[0.02] px-5 py-4 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <div>
          <p className="eyebrow !text-[10px]">Executive controls</p>
          <h2 className="mt-2 font-display text-2xl leading-tight text-[var(--color-pib-text)]">CRM leadership risk brief</h2>
        </div>
        <p className="text-sm leading-6 text-[var(--color-pib-text-muted)]">{riskCopy}</p>
      </div>
      <div className="grid divide-y divide-[var(--color-pib-line)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {risks.map((risk) => (
          <Link
            key={`${risk.href}-${risk.label}`}
            href={risk.href}
            aria-label={`${risk.actionLabel} to fix CRM risk: ${risk.label}`}
            className="group flex min-h-[132px] gap-4 p-5 transition-colors hover:bg-[var(--color-pib-surface-2)]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
              <span className="material-symbols-outlined text-[22px]" aria-hidden="true">{risk.icon}</span>
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{risk.label}</span>
              <span className="mt-1 block text-sm leading-6 text-[var(--color-pib-text-muted)]">{risk.description}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-label text-[var(--color-pib-accent)]">
                {risk.actionLabel}
                <span className="material-symbols-outlined text-sm transition-transform group-hover:translate-x-0.5" aria-hidden="true">arrow_forward</span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function PortalCrmPage() {
  const [dashboard, setDashboard] = useState<CrmDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/crm/dashboard')
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return
        if (!ok) throw new Error(body.error ?? 'Failed to load CRM dashboard')
        setDashboard(body.data ?? null)
        setError('')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load CRM dashboard')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const primaryCurrency = useMemo(() => dashboard?.topOpenDeals?.find((deal) => deal.currency)?.currency ?? 'ZAR', [dashboard])
  const commandMetrics = {
    openDealsCount: dashboard?.openDealsCount ?? 0,
    openDealsValue: dashboard?.openDealsValue ?? 0,
    weightedPipelineValue: dashboard?.weightedPipelineValue ?? 0,
    recentActivityCount: dashboard?.recentActivities?.length ?? 0,
    topOpenDealCount: dashboard?.topOpenDeals?.length ?? 0,
    lostThisMonthCount: dashboard?.lostThisMonth?.count ?? 0,
  }
  const leadershipRisks = useMemo(() => buildLeadershipRisks(dashboard), [dashboard])

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <p className="eyebrow">CRM command center</p>
          <h1 className="pib-page-title mt-2">CRM</h1>
          <p className="pib-page-sub mt-2">
            Sales movement, customer context, capture quality, and follow-up work for this workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/portal/contacts" className="btn-pib-secondary">
            <span className="material-symbols-outlined text-base" aria-hidden="true">contacts</span>
            Contacts
          </Link>
          <Link href="/portal/deals" className="btn-pib-accent">
            <span className="material-symbols-outlined text-base" aria-hidden="true">view_kanban</span>
            Pipeline
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[126px]" />)
        ) : (
          <>
            <DashboardMetric
              icon="paid"
              label="Open pipeline"
              value={formatCurrency(dashboard?.openDealsValue, primaryCurrency)}
              sub={`${dashboard?.openDealsCount ?? 0} active deals`}
            />
            <DashboardMetric
              icon="trending_up"
              label="Weighted forecast"
              value={formatCurrency(dashboard?.weightedPipelineValue, primaryCurrency)}
              sub="Probability adjusted"
            />
            <DashboardMetric
              icon="emoji_events"
              label="Won this month"
              value={formatCurrency(dashboard?.wonThisMonth?.value, primaryCurrency)}
              sub={`${dashboard?.wonThisMonth?.count ?? 0} closed wins`}
            />
            <DashboardMetric
              icon="warning"
              label="Lost this month"
              value={String(dashboard?.lostThisMonth?.count ?? 0)}
              sub="Review loss reasons"
            />
          </>
        )}
      </section>

      {!loading && <CrmHubCommandRail metrics={commandMetrics} />}

      {!loading && <CrmLeadershipRiskBrief risks={leadershipRisks} />}

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="pib-card-section overflow-hidden">
          <div className="border-b border-[var(--color-pib-line)] bg-white/[0.02] px-5 py-3.5">
            <p className="eyebrow !text-[10px]">Top open deals</p>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
            </div>
          ) : !dashboard?.topOpenDeals?.length ? (
            <div className="p-10 text-center">
              <span className="material-symbols-outlined text-4xl text-[var(--color-accent-v2)]" aria-hidden="true">monetization_on</span>
              <h2 className="mt-3 font-display text-2xl text-[var(--color-pib-text)]">Build the first active pipeline.</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-pib-text-muted)]">
                Create a deal so leadership can see value, owner, and next-step accountability from this command center.
              </p>
              <Link
                href="/portal/deals?create=deal"
                aria-label="Create first deal from CRM command center"
                className="pib-btn-primary mt-4 inline-flex items-center gap-1.5 text-sm"
              >
                <span className="material-symbols-outlined text-base">add_circle</span>
                Create first deal
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-pib-line)]">
              {dashboard.topOpenDeals.map((deal) => (
                <Link
                  key={deal.id}
                  href={`/portal/deals/${deal.id}`}
                  className="grid gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-pib-surface-2)] md:grid-cols-[1fr_120px_90px]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{deal.title}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--color-pib-text-muted)]">
                      {deal.contactName ?? deal.contactId ?? 'No contact linked'}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-[var(--color-pib-text)]">{formatCurrency(deal.value, deal.currency)}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{deal.probability ?? 50}%</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="pib-card-section overflow-hidden">
          <div className="border-b border-[var(--color-pib-line)] bg-white/[0.02] px-5 py-3.5">
            <p className="eyebrow !text-[10px]">Recent CRM activity</p>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-11" />)}
            </div>
          ) : !dashboard?.recentActivities?.length ? (
            <div className="p-10 text-center">
              <span className="material-symbols-outlined text-4xl text-[var(--color-accent-v2)]" aria-hidden="true">history</span>
              <h2 className="mt-3 font-display text-2xl text-[var(--color-pib-text)]">Relationship activity missing</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-pib-text-muted)]">
                Open the stale follow-up lens so managers can assign calls, emails, meetings, and notes before accounts go quiet.
              </p>
              <Link
                href="/portal/contacts?followUp=stale"
                aria-label="Open stale contacts from CRM command center"
                className="pib-btn-primary mt-4 inline-flex items-center gap-1.5 text-sm"
              >
                <span className="material-symbols-outlined text-base">contacts</span>
                Open contacts
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-pib-line)]">
              {dashboard.recentActivities.map((activity) => {
                const href = activityHref(activity)
                const content = (
                  <>
                    <span className="material-symbols-outlined mt-0.5 text-[17px] text-[var(--color-pib-text-muted)]">radio_button_checked</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[var(--color-pib-text)]">{activitySummary(activity)}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                        {activityContactLabel(activity.contactName)} · {' '}
                        {formatRelative(activity.createdAt)}
                      </p>
                    </div>
                  </>
                )
                const className = 'flex gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-pib-surface-2)]'
                return href ? (
                  <Link key={activity.id} href={href} className={className}>
                    {content}
                  </Link>
                ) : (
                  <div key={activity.id} className="flex gap-3 px-5 py-3.5">
                    {content}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {SECTIONS.map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="text-sm font-label font-semibold uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            {section.title}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {section.actions.map((action) => (
              <Link
                key={`${section.title}-${action.href}-${action.label}`}
                href={action.href}
                aria-label={hubActionLabel(action.label)}
                className="pib-card group min-h-[152px] p-5 transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.03]"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">{action.icon}</span>
                  </span>
                  {action.eyebrow && <span className="pill !px-2 !py-0.5 !text-[10px]">{action.eyebrow}</span>}
                </div>
                <h3 className="mt-4 text-base font-display leading-snug text-[var(--color-pib-text)]">{action.label}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">{action.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-label text-[var(--color-pib-accent)]">
                  Open
                  <span className="material-symbols-outlined text-sm transition-transform group-hover:translate-x-0.5" aria-hidden="true">arrow_forward</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
