'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Surface, StatusPill } from '@/components/ui/AppFoundation'
import { cn } from '@/lib/utils'

type Summary = {
  totalProjects?: number
  openTasks?: number
  blockedTasks?: number
  overdueTasks?: number
  waitingApprovals?: number
  highRisks?: number
  overCapacityPeople?: number
  trackedRevenue?: number
  currency?: string | null
  mixedCurrency?: boolean
}

type ClientReport = {
  clientOrgId: string
  companyId?: string
  clientName: string
  projectCount?: number
  trackedRevenue?: number
  openTasks?: number
  blockedTasks?: number
  highRisks?: number
}

type PersonReport = {
  uid: string
  name: string
  assignedTasks?: number
  estimateMinutes?: number
  capacityMinutes?: number
  utilizationPercent?: number
  overCapacity?: boolean
}

type ProjectReport = {
  id: string
  name: string
  companyId?: string
  status?: string
  health?: { status?: string; score?: number }
  timeline?: { driftCount?: number; dependencyCount?: number }
  reports?: {
    tasks?: { open?: number; blocked?: number }
    risks?: { high?: number }
    revenue?: { trackedAmount?: number; currency?: string }
  }
}

type PortfolioReport = {
  summary?: Summary
  clients?: ClientReport[]
  people?: PersonReport[]
  projects?: ProjectReport[]
}

type LoadState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: PortfolioReport; error: null }
  | { status: 'error'; data: null; error: string }

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`
}

function formatCurrency(amount: number, currency?: string | null) {
  if (!amount) return 'No tracked revenue'
  if (!currency) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount)
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatMinutes(minutes: number) {
  if (!minutes) return '0h'
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function displayStatus(value: string | undefined) {
  const status = value?.trim() || 'unknown'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function healthTone(status: string | undefined): 'success' | 'warn' | 'danger' | 'neutral' {
  const normalized = status?.toLowerCase()
  if (normalized === 'healthy' || normalized === 'on_track') return 'success'
  if (normalized === 'at_risk' || normalized === 'warning') return 'warn'
  if (normalized === 'critical' || normalized === 'blocked') return 'danger'
  return 'neutral'
}

function metricToneColor(tone: 'neutral' | 'info' | 'warn' | 'danger' | 'success' | 'purple'): string {
  return {
    neutral: 'var(--color-outline)',
    info: '#60a5fa',
    warn: '#f59e0b',
    danger: '#ef4444',
    success: '#22c55e',
    purple: '#c084fc',
  }[tone]
}

function StatTile({
  icon,
  value,
  label,
  detail,
  tone = 'neutral',
}: {
  icon: string
  value: string
  label: string
  detail: string
  tone?: 'neutral' | 'info' | 'warn' | 'danger' | 'success' | 'purple'
}) {
  const color = metricToneColor(tone)

  return (
    <div
      className="min-w-0 rounded-[18px] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-4 text-on-surface"
      style={{ borderTop: `2px solid ${color}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
        <span
          aria-hidden="true"
          className="material-symbols-outlined inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[15px]"
          style={{ borderColor: `${color}55`, color }}
        >
          {icon}
        </span>
      </div>
      <div className="mt-3 truncate text-2xl font-semibold text-on-surface">{value}</div>
      <p className="mt-2 min-h-8 text-xs leading-snug text-on-surface-variant">{detail}</p>
    </div>
  )
}

function Lane({
  title,
  icon,
  count,
  color,
  children,
}: {
  title: string
  icon: string
  count?: number
  color: string
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-on-surface-variant">{icon}</span>
        <h3 className="truncate text-xs font-label uppercase tracking-widest text-on-surface-variant">{title}</h3>
        {typeof count === 'number' ? (
          <span className="ml-auto rounded-full bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[9px] font-label text-on-surface-variant">
            {count}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </section>
  )
}

function EmptyLane({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-[var(--color-card-border)] px-3 py-8 text-center text-xs text-on-surface-variant">
      {children}
    </div>
  )
}

function RailCard({
  children,
  color = 'var(--color-outline)',
  className,
  href,
  ariaLabel,
}: {
  children: ReactNode
  color?: string
  className?: string
  href?: string
  ariaLabel?: string
}) {
  const cardClassName = cn(
    'pib-card min-w-0 transition-all duration-150 hover:border-[var(--color-accent-v2)]',
    href && 'block cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-v2)]',
    className,
  )
  const style = { borderLeft: `3px solid ${color}`, padding: '12px' }

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={cardClassName} style={style}>
        {children}
      </Link>
    )
  }

  return (
    <div
      className={cardClassName}
      style={style}
    >
      {children}
    </div>
  )
}

type ProjectPortfolioReportPanelProps = {
  reportUrl?: string
  projectHrefBase?: string
  companyHrefBase?: string
  buildProjectHref?: (projectId: string) => string
  buildCompanyHref?: (companyId: string) => string
}

function joinHref(base: string, id: string): string {
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(id)}`
}

export function ProjectPortfolioReportPanel({
  reportUrl = '/api/v1/projects/reporting',
  projectHrefBase = '/portal/projects',
  companyHrefBase = '/portal/companies',
  buildProjectHref,
  buildCompanyHref,
}: ProjectPortfolioReportPanelProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading', data: null, error: null })

  useEffect(() => {
    const controller = new AbortController()

    fetch(reportUrl, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'Reporting request failed')
        setState({ status: 'ready', data: body?.data ?? {}, error: null })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', data: null, error: error instanceof Error ? error.message : 'Reporting request failed' })
      })

    return () => controller.abort()
  }, [reportUrl])

  const data = state.data
  const summary = data?.summary ?? {}
  const clients = useMemo(() => (data?.clients ?? []).slice(0, 4), [data?.clients])
  const people = useMemo(() => (data?.people ?? []).slice(0, 4), [data?.people])
  const projects = useMemo(() => (data?.projects ?? []).slice(0, 5), [data?.projects])

  if (state.status === 'loading') {
    return (
      <Surface className="p-4">
        <div className="flex items-center gap-3 text-sm text-on-surface-variant">
          <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
          <span>Loading portfolio report</span>
        </div>
      </Surface>
    )
  }

  if (state.status === 'error') {
    return (
      <Surface className="p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[18px] text-[#f59e0b]">warning</span>
          <div>
            <h2 className="text-sm font-semibold text-on-surface">Portfolio report unavailable</h2>
            <p className="mt-1 text-xs text-on-surface-variant">{state.error}</p>
          </div>
        </div>
      </Surface>
    )
  }

  const totalProjects = numberValue(summary.totalProjects)
  const blockedTasks = numberValue(summary.blockedTasks)
  const openTasks = numberValue(summary.openTasks)
  const overdueTasks = numberValue(summary.overdueTasks)
  const waitingApprovals = numberValue(summary.waitingApprovals)
  const highRisks = numberValue(summary.highRisks)
  const overCapacityPeople = numberValue(summary.overCapacityPeople)
  const trackedRevenue = numberValue(summary.trackedRevenue)
  const currency = summary.mixedCurrency ? null : summary.currency
  const activePressure = blockedTasks + overdueTasks + waitingApprovals + highRisks
  const clearWork = Math.max(openTasks - blockedTasks - overdueTasks, 0)
  const clearWorkPercent = openTasks > 0 ? Math.round((clearWork / openTasks) * 100) : 100
  const healthColor = activePressure > 0 ? '#f59e0b' : '#22c55e'

  return (
    <Surface className="p-0 overflow-hidden">
      <div className="grid border-b border-[var(--color-card-border)] lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.7fr)]">
        <div className="relative min-w-0 border-b border-[var(--color-card-border)] px-5 py-5 lg:border-b-0 lg:border-r">
          <span
            aria-hidden="true"
            className="material-symbols-outlined absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-full border text-[20px]"
            style={{ borderColor: `${healthColor}55`, color: healthColor, background: `${healthColor}12` }}
          >
            monitoring
          </span>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Portfolio report</p>
          <div className="mt-3 flex items-end gap-2">
            <span className="text-4xl font-semibold leading-none text-on-surface">{totalProjects}</span>
            <span className="pb-1 text-lg font-medium text-on-surface-variant">{totalProjects === 1 ? 'project' : 'projects'}</span>
          </div>
          <p className="mt-3 max-w-sm text-sm text-on-surface-variant">
            {plural(openTasks, 'open', 'open')} across {plural(clients.length, 'client')}. {activePressure > 0 ? `${activePressure} item${activePressure === 1 ? '' : 's'} need attention.` : 'No active blockers in the portfolio report.'}
          </p>

          <div className="mt-6 flex items-center justify-between gap-3 text-xs text-on-surface-variant">
            <span>Clear work</span>
            <span>{clearWorkPercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30">
            <div
              className="h-full rounded-full"
              style={{ width: `${clearWorkPercent}%`, background: healthColor }}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-xs text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-2.5 py-1.5">
              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">database</span>
              Live data
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-2.5 py-1.5">
              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">schedule</span>
              {plural(overdueTasks, 'overdue', 'overdue')}
            </span>
            {overCapacityPeople > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f59e0b40] bg-[#f59e0b10] px-2.5 py-1.5 text-[#fbbf24]">
                <span aria-hidden="true" className="material-symbols-outlined text-[15px]">groups</span>
                {plural(overCapacityPeople, 'person', 'people')} over capacity
              </span>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 px-4 py-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile icon="radio_button_checked" label="Open tasks" value={String(openTasks)} detail="All non-complete task load in this report." tone="info" />
            <StatTile icon="sync" label="Overdue" value={String(overdueTasks)} detail="Past due work across project boards." tone={overdueTasks > 0 ? 'warn' : 'neutral'} />
            <StatTile icon="block" label="Blocked now" value={String(blockedTasks)} detail="Active blocked or waiting-only work." tone={blockedTasks > 0 ? 'danger' : 'success'} />
            <StatTile icon="rate_review" label="Approvals" value={String(waitingApprovals)} detail="Client or internal decisions waiting." tone={waitingApprovals > 0 ? 'purple' : 'neutral'} />
            <StatTile icon="warning" label="High risks" value={String(highRisks)} detail="Open high-severity project risks." tone={highRisks > 0 ? 'danger' : 'success'} />
            <StatTile icon="payments" label="Revenue" value={formatCurrency(trackedRevenue, currency)} detail="Tracked project revenue in scope." tone="success" />
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-[var(--color-pib-accent)]" style={{ width: `${clearWorkPercent}%` }} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-on-surface-variant">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#60a5fa]" />
              Open {openTasks}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" />
              Blocked {blockedTasks}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c084fc]" />
              Review {waitingApprovals}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
              Clear {clearWork}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-3">
        <Lane title="Client portfolio" icon="business_center" count={clients.length} color="#60a5fa">
          {clients.length === 0 ? (
            <EmptyLane>No client reporting data yet.</EmptyLane>
          ) : clients.map((client) => {
            const clientBlockedTasks = numberValue(client.blockedTasks)
            const clientHref = client.companyId ? (buildCompanyHref?.(client.companyId) ?? joinHref(companyHrefBase, client.companyId)) : undefined
            return (
              <RailCard
                key={client.clientOrgId}
                color={clientBlockedTasks > 0 ? '#ef4444' : '#60a5fa'}
                href={clientHref}
                ariaLabel={clientHref ? `Open company ${client.clientName}` : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-on-surface">
                      <span className="truncate">{client.clientName}</span>
                      {clientHref ? <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[14px] text-on-surface-variant">arrow_outward</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {plural(numberValue(client.projectCount), 'project')} · {plural(numberValue(client.openTasks), 'open', 'open')} · {plural(clientBlockedTasks, 'blocked', 'blocked')}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--color-surface-container)] px-2 py-0.5 text-[10px] font-semibold text-on-surface">
                    {formatCurrency(numberValue(client.trackedRevenue), currency)}
                  </span>
                </div>
                {numberValue(client.highRisks) > 0 ? (
                  <p className="mt-2 inline-flex items-center gap-1 rounded border border-[#ef444440] bg-[#ef444410] px-2 py-1 text-[10px] text-[#f87171]">
                    <span aria-hidden="true" className="material-symbols-outlined text-[13px]">warning</span>
                    {plural(numberValue(client.highRisks), 'high risk')}
                  </p>
                ) : null}
              </RailCard>
            )
          })}
        </Lane>

        <Lane title="Project health" icon="view_kanban" count={projects.length} color="var(--color-accent-v2)">
          {projects.length === 0 ? (
            <EmptyLane>No project health data yet.</EmptyLane>
          ) : projects.map((project) => {
            const healthStatus = project.health?.status
            const projectBlockedTasks = numberValue(project.reports?.tasks?.blocked)
            const railColor = healthTone(healthStatus) === 'danger' || projectBlockedTasks > 0 ? '#ef4444' : healthTone(healthStatus) === 'warn' ? '#f59e0b' : 'var(--color-accent-v2)'
            return (
              <RailCard key={project.id} color={railColor} href={buildProjectHref?.(project.id) ?? joinHref(projectHrefBase, project.id)} ariaLabel={`Open project ${project.name}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-on-surface">
                      <span className="truncate">{project.name}</span>
                      <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[14px] text-on-surface-variant">arrow_outward</span>
                    </p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {displayStatus(project.status)} · {plural(numberValue(project.reports?.tasks?.open), 'open', 'open')} · {plural(numberValue(project.timeline?.dependencyCount), 'dependency', 'dependencies')}
                    </p>
                  </div>
                  <StatusPill tone={healthTone(healthStatus)}>{displayStatus(healthStatus)}</StatusPill>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-on-surface-variant">
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className="material-symbols-outlined text-[13px]">timeline</span>
                    {numberValue(project.timeline?.driftCount)} drift
                  </span>
                  {projectBlockedTasks > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[#f87171]">
                      <span aria-hidden="true" className="material-symbols-outlined text-[13px]">block</span>
                      {plural(projectBlockedTasks, 'blocked', 'blocked')}
                    </span>
                  ) : null}
                </div>
              </RailCard>
            )
          })}
        </Lane>

        <Lane title="Workload" icon="groups" count={people.length} color="#c084fc">
          {people.length === 0 ? (
            <EmptyLane>No workload data yet.</EmptyLane>
          ) : people.map((person) => {
            const utilization = numberValue(person.utilizationPercent)
            return (
              <RailCard key={person.uid} color={person.overCapacity ? '#f59e0b' : '#c084fc'}>
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium text-on-surface">{person.name}</p>
                  <span className={person.overCapacity ? 'text-sm font-semibold text-[#f59e0b]' : 'text-sm font-semibold text-on-surface'}>
                    {utilization}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={person.overCapacity ? 'h-full rounded-full bg-[#f59e0b]' : 'h-full rounded-full bg-[var(--color-pib-accent)]'}
                    style={{ width: `${Math.min(utilization, 140)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-on-surface-variant">
                  {plural(numberValue(person.assignedTasks), 'task')} · {formatMinutes(numberValue(person.estimateMinutes))} planned / {formatMinutes(numberValue(person.capacityMinutes))} capacity
                </p>
              </RailCard>
            )
          })}
        </Lane>
      </div>
    </Surface>
  )
}
