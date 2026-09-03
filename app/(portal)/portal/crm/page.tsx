'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CrmSearchBar } from '@/components/crm/CrmSearchBar'
import { CrmHubCommandRail } from '@/components/crm/CrmHubCommandRail'
import { TrendAreaChart, DonutChart } from '@/components/ui/Charts'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import type { HubSection } from '@/components/navigation/HubPage'
import type { Deal } from '@/lib/crm/types'
import { canAccessModule, normalizeMemberAccessPolicy, type MemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'

type CrmDashboard = {
  openDealsCount?: number
  openDealsValue?: number
  weightedPipelineValue?: number
  wonThisMonth?: { count?: number; value?: number }
  lostThisMonth?: { count?: number }
  recentActivities?: Array<{ id: string; type?: string; summary?: string; contactName?: string; contactId?: string; dealId?: string; createdAt?: unknown }>
  topOpenDeals?: Array<Deal & { contactName?: string }>
  totalContacts?: number
  newThisMonth?: number
  activeLeads?: number
  convertedClients?: number
  conversionRate?: number
  contactGrowth?: Array<{ label: string; value: number }>
  sourceBreakdown?: Array<{ name: string; value: number }>
}

type CrmLeadershipRisk = {
  label: string
  description: string
  href: string
  icon: string
  actionLabel: string
}

type PortalHrefBuilder = (path: string) => string

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

function formatPercent(value: unknown): string {
  const ratio = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return `${(ratio * 100).toFixed(1)}%`
}

function formatCount(value: unknown): string {
  return numberValue(value).toLocaleString('en-ZA')
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

function activityHref(
  activity: NonNullable<CrmDashboard['recentActivities']>[number],
  buildHref: PortalHrefBuilder = (path) => path,
): string {
  const dealId = textValue(activity.dealId)
  if (dealId) return buildHref(`/portal/deals/${encodeURIComponent(dealId)}`)
  const contactId = textValue(activity.contactId)
  return contactId ? buildHref(`/portal/contacts/${encodeURIComponent(contactId)}`) : ''
}

function topDealHasContact(deal: NonNullable<CrmDashboard['topOpenDeals']>[number]): boolean {
  return Boolean(textValue(deal.contactName) || textValue(deal.contactId))
}

function topDealContactLabel(deal: NonNullable<CrmDashboard['topOpenDeals']>[number]): string {
  return textValue(deal.contactName) || textValue(deal.contactId) || 'Contact cleanup needed'
}

function topDealHref(
  deal: NonNullable<CrmDashboard['topOpenDeals']>[number],
  buildHref: PortalHrefBuilder = (path) => path,
): string {
  if (!topDealHasContact(deal)) {
    return buildHref('/portal/deals?view=list&focus=needsContact')
  }
  return buildHref(`/portal/deals/${encodeURIComponent(deal.id)}`)
}

function topDealActionLabel(deal: NonNullable<CrmDashboard['topOpenDeals']>[number]): string | undefined {
  return topDealHasContact(deal) ? undefined : `Open missing contact cleanup for ${deal.title}`
}

function countActivityAttributionGaps(activities: CrmDashboard['recentActivities']): number {
  return activities?.filter((activity) => !textValue(activity.contactName)).length ?? 0
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

function CrmLeadershipRiskBrief({
  risks,
  buildHref = (path) => path,
}: {
  risks: CrmLeadershipRisk[]
  buildHref?: PortalHrefBuilder
}) {
  if (!risks.length) return null
  const riskCopy = `${risks.length} CRM ${risks.length === 1 ? 'risk needs' : 'risks need'} leadership attention before this workspace is board-ready.`

  return (
    <Surface
      variant="list"
      accentEdge="amber"
      header={
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <p className="pib-label mb-0">Executive controls</p>
          <h2 className="text-sm text-[var(--color-pib-text)]">CRM leadership risk brief</h2>
          <p className="min-w-0 text-xs leading-5 text-[var(--color-pib-text-muted)]">{riskCopy}</p>
        </div>
      }
      bodyClassName="!p-0"
    >
      <div className="grid divide-y divide-[var(--color-card-border)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {risks.map((risk) => (
          <Link
            key={`${risk.href}-${risk.label}`}
            href={buildHref(risk.href)}
            aria-label={`${risk.actionLabel} to fix CRM risk: ${risk.label}`}
            className="group flex gap-2.5 p-3 pib-enter transition-colors hover:bg-[var(--color-row-hover)]"
          >
            <Icon name={risk.icon} />
            <span className="min-w-0">
              <span className="block text-sm text-[var(--color-pib-text)]">{risk.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-[var(--color-pib-text-muted)]">{risk.description}</span>
              <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent-text)]">
                {risk.actionLabel}
                <Icon name="arrow_forward" />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </Surface>
  )
}

function ActivityAttributionReview({
  count,
  buildHref = (path) => path,
}: {
  count: number
  buildHref?: PortalHrefBuilder
}) {
  if (count <= 0) return null
  const itemCopy = `${count} recent CRM activity ${count === 1 ? 'item is' : 'items are'} missing visible contact or deal names.`

  return (
    <div className="border-b border-[var(--color-card-border)] bg-[var(--color-pib-accent-soft)] px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-2.5">
          <Icon name="hub" />
          <div>
            <p className="pib-label mb-0 text-[var(--color-pib-accent)]">Activity hygiene</p>
            <h2 className="mt-0.5 text-sm text-[var(--color-pib-text)]">Activity attribution needs review</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
              {itemCopy} Managers need those touches clearly attributed before activity can drive accountable follow-up.
            </p>
          </div>
        </div>
        <Link
          href={buildHref('/portal/contacts?followUp=stale')}
          aria-label="Review unlinked CRM activity from command center"
          className="btn-pib-secondary btn-pib-sm shrink-0"
        >
          <Icon name="contacts" />
          Review follow-up
        </Link>
      </div>
    </div>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function PortalCrmPage() {
  const searchParams = useSearchParams()
  const [dashboard, setDashboard] = useState<CrmDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [memberPolicy, setMemberPolicy] = useState<MemberAccessPolicy | null>(null)
  const routeScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const crmApiPath = useCallback((path: string) => scopedApiPath(path, routeScope), [routeScope])
  const crmPortalPath = useCallback((path: string) => scopedPortalPath(path, routeScope), [routeScope])

  useEffect(() => {
    let cancelled = false
    fetch(crmApiPath('/api/v1/portal/org'))
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return
        if (body?.user?.accessPolicy) setMemberPolicy(normalizeMemberAccessPolicy(body.user.accessPolicy))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [crmApiPath])

  useEffect(() => {
    let cancelled = false
    fetch(crmApiPath('/api/v1/crm/dashboard'))
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
  }, [crmApiPath])

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
  const activityAttributionGapCount = useMemo(
    () => countActivityAttributionGaps(dashboard?.recentActivities),
    [dashboard?.recentActivities],
  )

  return (
    <div className="mx-auto flex max-w-7xl min-w-0 flex-col space-y-4" data-module-accent="amber">
      <PageHeader
        accent="amber"
        eyebrow="CRM command center"
        title="CRM"
        description="Sales movement, customer context, capture quality, and follow-up work for this workspace."
        actions={
          <>
            <CrmSearchBar orgScope={routeScope} className="w-56" />
            <Link href={crmPortalPath('/portal/contacts')} className="btn-pib-secondary btn-pib-sm">
              <Icon name="contacts" />
              Contacts
            </Link>
            <Link href={crmPortalPath('/portal/deals')} className="btn-pib-primary btn-pib-sm">
              <Icon name="view_kanban" />
              Pipeline
            </Link>
          </>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16" />)
        ) : (
          <>
            <StatCard
              accent="amber"
              icon="paid"
              label="Open pipeline"
              value={formatCurrency(dashboard?.openDealsValue, primaryCurrency)}
              detail={`${dashboard?.openDealsCount ?? 0} active deals`}
            />
            <StatCard
              accent="amber"
              icon="trending_up"
              label="Weighted forecast"
              value={formatCurrency(dashboard?.weightedPipelineValue, primaryCurrency)}
              detail="Probability adjusted"
            />
            <StatCard
              accent="amber"
              icon="emoji_events"
              label="Won this month"
              value={formatCurrency(dashboard?.wonThisMonth?.value, primaryCurrency)}
              detail={`${dashboard?.wonThisMonth?.count ?? 0} closed wins`}
            />
            <StatCard
              accent="amber"
              icon="warning"
              label="Lost this month"
              value={String(dashboard?.lostThisMonth?.count ?? 0)}
              detail="Review loss reasons"
            />
          </>
        )}
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={`contact-metric-${index}`} className="h-16" />)
        ) : (
          <>
            <StatCard
              accent="amber"
              icon="contacts"
              label="Total contacts"
              value={formatCount(dashboard?.totalContacts)}
              detail="People in this workspace"
            />
            <StatCard
              accent="amber"
              icon="person_add"
              label="New this month"
              value={formatCount(dashboard?.newThisMonth)}
              detail="Contacts created this month"
            />
            <StatCard
              accent="amber"
              icon="flag"
              label="Active leads"
              value={formatCount(dashboard?.activeLeads)}
              detail="Leads still in the pipeline"
            />
            <StatCard
              accent="amber"
              icon="trending_up"
              label="Conversion rate"
              value={formatPercent(dashboard?.conversionRate)}
              detail={`${formatCount(dashboard?.convertedClients)} converted to clients`}
            />
          </>
        )}
      </section>

      <Surface variant="list" bodyClassName="!p-0">
        <div className="grid divide-y divide-[var(--color-card-border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Link
            href={crmPortalPath('/portal/contacts?create=contact')}
            aria-label="Add a new contact"
            className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--color-row-hover)]"
          >
            <Icon name="person_add" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--color-pib-text)]">Add contact</span>
              <span className="block text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Capture a new person in CRM</span>
            </span>
          </Link>
          <Link
            href={crmPortalPath('/portal/email?compose=1')}
            aria-label="Send an email"
            className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--color-row-hover)]"
          >
            <Icon name="mail" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--color-pib-text)]">Send email</span>
              <span className="block text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Reach a contact or audience</span>
            </span>
          </Link>
          <Link
            href={crmPortalPath('/portal/segments?create=segment')}
            aria-label="Create a segment"
            className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--color-row-hover)]"
          >
            <Icon name="group_work" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--color-pib-text)]">Create segment</span>
              <span className="block text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Build a targeted audience</span>
            </span>
          </Link>
        </div>
      </Surface>

      <section className="grid gap-3 xl:grid-cols-[1.4fr_0.6fr]">
        <Surface
          variant="card"
          header={<p className="pib-label mb-0">Contact growth</p>}
          bodyClassName="p-3"
        >
          {loading ? (
            <Skeleton className="h-[200px]" />
          ) : (dashboard?.contactGrowth?.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-xs text-[var(--color-pib-text-muted)]">
              No contact history yet for this workspace.
            </p>
          ) : (
            <TrendAreaChart data={dashboard!.contactGrowth!} height={200} />
          )}
        </Surface>

        <Surface
          variant="card"
          header={<p className="pib-label mb-0">Source breakdown</p>}
          bodyClassName="p-3"
        >
          {loading ? (
            <Skeleton className="h-[220px]" />
          ) : (dashboard?.sourceBreakdown?.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-xs text-[var(--color-pib-text-muted)]">
              No contacts to attribute yet.
            </p>
          ) : (
            <DonutChart
              data={dashboard!.sourceBreakdown!}
              centerLabel="Contacts"
              centerValue={formatCount(dashboard?.totalContacts)}
            />
          )}
        </Surface>
      </section>

      {!loading && <CrmHubCommandRail metrics={commandMetrics} buildHref={crmPortalPath} />}

      {!loading && <CrmLeadershipRiskBrief risks={leadershipRisks} buildHref={crmPortalPath} />}

      <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <Surface
          variant="list"
          header={<p className="pib-label mb-0">Top open deals</p>}
          bodyClassName="!p-0"
        >
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10" />)}
            </div>
          ) : !dashboard?.topOpenDeals?.length ? (
            <div className="p-4 text-center">
              <Icon name="monetization_on" />
              <h2 className="mt-2 text-sm text-[var(--color-pib-text)]">Build the first active pipeline.</h2>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--color-pib-text-muted)]">
                Create a deal so leadership can see value, owner, and next-step accountability from this command center.
              </p>
              <Link
                href={crmPortalPath('/portal/deals?create=deal')}
                aria-label="Create first deal from CRM command center"
                className="btn-pib-primary btn-pib-sm mt-3"
              >
                <Icon name="add_circle" />
                Create first deal
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-card-border)]">
              {dashboard.topOpenDeals.map((deal) => {
                const actionLabel = topDealActionLabel(deal)
                return (
                  <Link
                    key={deal.id}
                    href={topDealHref(deal, crmPortalPath)}
                    aria-label={actionLabel}
                    className="grid gap-2 px-3 py-2 pib-enter transition-colors hover:bg-[var(--color-row-hover)] md:grid-cols-[1fr_120px_90px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{deal.title}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                        {topDealContactLabel(deal)}
                      </p>
                    </div>
                    <p className="text-sm font-medium tabular-nums text-[var(--color-pib-text)]">{formatCurrency(deal.value, deal.currency)}</p>
                    <p className="font-mono text-xs text-[var(--color-pib-text-muted)]">{deal.probability ?? 50}%</p>
                  </Link>
                )
              })}
            </div>
          )}
        </Surface>

        <Surface
          variant="list"
          header={<p className="pib-label mb-0">Recent CRM activity</p>}
          bodyClassName="!p-0"
        >
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-9" />)}
            </div>
          ) : !dashboard?.recentActivities?.length ? (
            <div className="p-4 text-center">
              <Icon name="history" />
              <h2 className="mt-2 text-sm text-[var(--color-pib-text)]">Relationship activity missing</h2>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--color-pib-text-muted)]">
                Open the stale follow-up lens so managers can assign calls, emails, meetings, and notes before accounts go quiet.
              </p>
              <Link
                href={crmPortalPath('/portal/contacts?followUp=stale')}
                aria-label="Open stale contacts from CRM command center"
                className="btn-pib-primary btn-pib-sm mt-3"
              >
                <Icon name="contacts" />
                Open contacts
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-card-border)]">
              <ActivityAttributionReview count={activityAttributionGapCount} buildHref={crmPortalPath} />
              {dashboard.recentActivities.map((activity) => {
                const href = activityHref(activity, crmPortalPath)
                const content = (
                  <>
                    <Icon name="radio_button_checked" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[var(--color-pib-text)]">{activitySummary(activity)}</p>
                      <p className="mt-0.5 font-mono text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                        {activityContactLabel(activity.contactName)} · {' '}
                        {formatRelative(activity.createdAt)}
                      </p>
                    </div>
                  </>
                )
                const className = 'flex gap-2.5 px-3 py-2 pib-enter transition-colors hover:bg-[var(--color-row-hover)]'
                return href ? (
                  <Link key={activity.id} href={href} className={className}>
                    {content}
                  </Link>
                ) : (
                  <div key={activity.id} className="flex gap-2.5 px-3 py-2">
                    {content}
                  </div>
                )
              })}
            </div>
          )}
        </Surface>
      </section>

      {SECTIONS
        .filter((section) => (
          section.title !== 'Configuration'
          || canAccessModule(memberPolicy, 'configuration')
        ))
        .map((section) => (
        <Surface
          key={section.title}
          variant="list"
          header={
            <h2 className="pib-label mb-0">
              {section.title}
            </h2>
          }
          bodyClassName="!p-0"
        >
          <div className="divide-y divide-[var(--color-card-border)]">
            {section.actions.map((action) => (
              <Link
                key={`${section.title}-${action.href}-${action.label}`}
                href={crmPortalPath(action.href)}
                aria-label={hubActionLabel(action.label)}
                className="group flex items-center gap-2.5 px-3 py-2 pib-enter transition-colors hover:bg-[var(--color-row-hover)]"
              >
                <Icon name={action.icon} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-[var(--color-pib-text)]">{action.label}</h3>
                    {action.eyebrow && (
                      <span className="pib-pill px-2 py-0.5 text-[10px]">
                        {action.eyebrow}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{action.description}</span>
                </span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--color-accent-text)]">
                  Open
                  <Icon name="arrow_forward" />
                </span>
              </Link>
            ))}
          </div>
        </Surface>
      ))}
    </div>
  )
}
