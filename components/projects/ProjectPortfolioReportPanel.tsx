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

function StatTile({ icon, value, label, tone = 'neutral' }: { icon: string; value: string; label: string; tone?: 'neutral' | 'warn' | 'danger' | 'success' }) {
  const toneClass = {
    neutral: 'border-[var(--color-card-border)] bg-[var(--color-card)] text-on-surface',
    warn: 'border-[#f59e0b40] bg-[#f59e0b10] text-[#fbbf24]',
    danger: 'border-[#ef444440] bg-[#ef444410] text-[#f87171]',
    success: 'border-[#22c55e40] bg-[#22c55e10] text-[#86efac]',
  }[tone]

  return (
    <div className={cn('min-w-0 rounded-md border px-3 py-3', toneClass)}>
      <div className="flex items-center gap-2 text-xs text-on-surface-variant">
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-base font-semibold">{value}</div>
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
}

function joinHref(base: string, id: string): string {
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(id)}`
}

export function ProjectPortfolioReportPanel({
  reportUrl = '/api/v1/projects/reporting',
  projectHrefBase = '/portal/projects',
  companyHrefBase = '/portal/companies',
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
  const waitingApprovals = numberValue(summary.waitingApprovals)
  const highRisks = numberValue(summary.highRisks)
  const overCapacityPeople = numberValue(summary.overCapacityPeople)
  const trackedRevenue = numberValue(summary.trackedRevenue)
  const currency = summary.mixedCurrency ? null : summary.currency

  return (
    <Surface className="p-0 overflow-hidden">
      <div className="border-b border-[var(--color-card-border)] px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Portfolio health</p>
            <h2 className="mt-1 text-lg font-headline font-semibold text-on-surface">Portfolio report</h2>
            <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">A kanban-style readout of client load, project health, and team capacity.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-on-surface-variant">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-2 py-1">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">folder_managed</span>
              {plural(totalProjects, 'project')}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-2 py-1">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">database</span>
              Live data
            </span>
            {overCapacityPeople > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#f59e0b40] bg-[#f59e0b10] px-2 py-1 text-[#fbbf24]">
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">groups</span>
                {plural(overCapacityPeople, 'person', 'people')} over capacity
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile icon="task_alt" label="Open tasks" value={plural(numberValue(summary.openTasks), 'open', 'open')} />
          <StatTile icon="block" label="Blocked" value={plural(blockedTasks, 'blocked', 'blocked')} tone={blockedTasks > 0 ? 'danger' : 'success'} />
          <StatTile icon="schedule" label="Overdue" value={plural(numberValue(summary.overdueTasks), 'overdue', 'overdue')} tone={numberValue(summary.overdueTasks) > 0 ? 'warn' : 'neutral'} />
          <StatTile icon="approval" label="Approvals" value={plural(waitingApprovals, 'approval')} tone={waitingApprovals > 0 ? 'warn' : 'neutral'} />
          <StatTile icon="warning" label="High risks" value={plural(highRisks, 'risk')} tone={highRisks > 0 ? 'danger' : 'success'} />
          <StatTile icon="payments" label="Revenue" value={formatCurrency(trackedRevenue, currency)} />
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-3">
        <Lane title="Client portfolio" icon="business_center" count={clients.length} color="#60a5fa">
          {clients.length === 0 ? (
            <EmptyLane>No client reporting data yet.</EmptyLane>
          ) : clients.map((client) => {
            const clientBlockedTasks = numberValue(client.blockedTasks)
            const clientHref = client.companyId ? joinHref(companyHrefBase, client.companyId) : undefined
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
              <RailCard key={project.id} color={railColor} href={joinHref(projectHrefBase, project.id)} ariaLabel={`Open project ${project.name}`}>
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
