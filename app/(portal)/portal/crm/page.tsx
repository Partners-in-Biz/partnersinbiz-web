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
  recentActivities?: Array<{ id: string; type?: string; summary?: string; contactName?: string; createdAt?: unknown }>
  topOpenDeals?: Array<Deal & { contactName?: string }>
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

function formatRelative(value: unknown): string {
  const ms = timestampMs(value)
  if (!ms) return 'No date'
  const diffDays = Math.round((Date.now() - ms) / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 30) return `${diffDays}d ago`
  return new Date(ms).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
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
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-display leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
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
            <span className="material-symbols-outlined text-base">contacts</span>
            Contacts
          </Link>
          <Link href="/portal/deals" className="btn-pib-accent">
            <span className="material-symbols-outlined text-base">view_kanban</span>
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
              <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">monetization_on</span>
              <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">No open deals yet.</p>
              <Link
                href="/portal/deals"
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
              <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">history</span>
              <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">No CRM activity logged yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-pib-line)]">
              {dashboard.recentActivities.map((activity) => (
                <div key={activity.id} className="flex gap-3 px-5 py-3.5">
                  <span className="material-symbols-outlined mt-0.5 text-[17px] text-[var(--color-pib-text-muted)]">radio_button_checked</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--color-pib-text)]">{activity.summary ?? activity.type ?? 'CRM activity'}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                      {activity.contactName ? `${activity.contactName} · ` : ''}
                      {formatRelative(activity.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
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
                className="pib-card group min-h-[152px] p-5 transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.03]"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                    <span className="material-symbols-outlined text-[22px]">{action.icon}</span>
                  </span>
                  {action.eyebrow && <span className="pill !px-2 !py-0.5 !text-[10px]">{action.eyebrow}</span>}
                </div>
                <h3 className="mt-4 text-base font-display leading-snug text-[var(--color-pib-text)]">{action.label}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">{action.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-label text-[var(--color-pib-accent)]">
                  Open
                  <span className="material-symbols-outlined text-sm transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
