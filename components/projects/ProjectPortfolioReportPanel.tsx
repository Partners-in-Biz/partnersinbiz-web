'use client'

import { useEffect, useMemo, useState } from 'react'
import { Surface, StatusPill } from '@/components/ui/AppFoundation'

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

function StatTile({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--color-card-border)] bg-black/[0.12] px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-on-surface-variant">
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-base font-semibold text-on-surface">{value}</div>
    </div>
  )
}

export function ProjectPortfolioReportPanel({ reportUrl = '/api/v1/projects/reporting' }: { reportUrl?: string }) {
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
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Portfolio health</p>
            <h2 className="mt-1 text-lg font-headline font-semibold text-on-surface">Portfolio report</h2>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-on-surface-variant">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">folder_managed</span>
              {plural(totalProjects, 'project')}
            </span>
            {blockedTasks > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#ef444440] px-2 py-1 text-[#f87171]">
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">block</span>
                {plural(blockedTasks, 'blocked', 'blocked')}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile icon="task_alt" label="Open tasks" value={plural(numberValue(summary.openTasks), 'open', 'open')} />
          <StatTile icon="block" label="Blocked" value={plural(blockedTasks, 'blocked', 'blocked')} />
          <StatTile icon="schedule" label="Overdue" value={plural(numberValue(summary.overdueTasks), 'overdue', 'overdue')} />
          <StatTile icon="approval" label="Approvals" value={plural(waitingApprovals, 'approval')} />
          <StatTile icon="warning" label="High risks" value={plural(highRisks, 'risk')} />
          <StatTile icon="payments" label="Revenue" value={formatCurrency(trackedRevenue, currency)} />
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-on-surface">Client portfolio</h3>
              <span className="text-xs text-on-surface-variant">{plural(clients.length, 'client')}</span>
            </div>
            <div className="space-y-2">
              {clients.length === 0 ? (
                <p className="rounded-md border border-dashed border-[var(--color-card-border)] px-3 py-4 text-sm text-on-surface-variant">No client reporting data yet.</p>
              ) : clients.map((client) => (
                <div key={client.clientOrgId} className="grid gap-3 rounded-md border border-[var(--color-card-border)] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-on-surface">{client.clientName}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {plural(numberValue(client.projectCount), 'project')} · {plural(numberValue(client.openTasks), 'open', 'open')} · {plural(numberValue(client.blockedTasks), 'blocked', 'blocked')}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm font-semibold text-on-surface">{formatCurrency(numberValue(client.trackedRevenue), currency)}</p>
                    {numberValue(client.highRisks) > 0 ? <p className="mt-1 text-xs text-[#f87171]">{plural(numberValue(client.highRisks), 'high risk')}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-on-surface">Project health</h3>
              {overCapacityPeople > 0 ? <span className="text-xs text-[#f59e0b]">{plural(overCapacityPeople, 'person', 'people')} over capacity</span> : null}
            </div>
            <div className="space-y-2">
              {projects.length === 0 ? (
                <p className="rounded-md border border-dashed border-[var(--color-card-border)] px-3 py-4 text-sm text-on-surface-variant">No project health data yet.</p>
              ) : projects.map((project) => {
                const healthStatus = project.health?.status
                return (
                  <div key={project.id} className="grid gap-3 rounded-md border border-[var(--color-card-border)] px-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-on-surface">{project.name}</p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {displayStatus(project.status)} · {plural(numberValue(project.reports?.tasks?.open), 'open', 'open')} · {plural(numberValue(project.timeline?.dependencyCount), 'dependency', 'dependencies')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <StatusPill tone={healthTone(healthStatus)}>{displayStatus(healthStatus)}</StatusPill>
                      <span className="text-xs text-on-surface-variant">{numberValue(project.timeline?.driftCount)} drift</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-on-surface">Workload</h3>
            <div className="space-y-2">
              {people.length === 0 ? (
                <p className="rounded-md border border-dashed border-[var(--color-card-border)] px-3 py-4 text-sm text-on-surface-variant">No workload data yet.</p>
              ) : people.map((person) => {
                const utilization = numberValue(person.utilizationPercent)
                return (
                  <div key={person.uid} className="rounded-md border border-[var(--color-card-border)] px-3 py-3">
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
                  </div>
                )
              })}
            </div>
          </section>

          {projects[0]?.id ? (
            <div className="flex items-center justify-between rounded-md border border-[var(--color-card-border)] px-3 py-3 text-sm text-on-surface-variant">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="material-symbols-outlined text-[17px]">monitoring</span>
                Suite source
              </span>
              <span className="font-medium text-on-surface">Live data</span>
            </div>
          ) : null}
        </aside>
      </div>
    </Surface>
  )
}
