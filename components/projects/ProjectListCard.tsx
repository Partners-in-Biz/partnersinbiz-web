'use client'

import { Icon } from '@/components/studio'

import Link from 'next/link'

export interface ProjectListCardProject {
  id: string
  name: string
  status: string
  description?: string
  createdAt?: unknown
  updatedAt?: unknown
}

const STATUS_META: Record<string, { label: string; color: string; icon: string; progress: number; summary: string }> = {
  discovery: {
    label: 'Discovery',
    color: '#60a5fa',
    icon: 'travel_explore',
    progress: 16,
    summary: 'Scope, objectives, and project shape are being defined.',
  },
  design: {
    label: 'Design',
    color: '#c084fc',
    icon: 'design_services',
    progress: 34,
    summary: 'Visual direction, UX, and content structure are in motion.',
  },
  development: {
    label: 'Development',
    color: '#34d399',
    icon: 'code_blocks',
    progress: 58,
    summary: 'Build work is active and implementation tasks are moving.',
  },
  review: {
    label: 'Review',
    color: '#f59e0b',
    icon: 'rate_review',
    progress: 76,
    summary: 'Work is ready for feedback, QA, or approval.',
  },
  live: {
    label: 'Live',
    color: '#4ade80',
    icon: 'rocket_launch',
    progress: 100,
    summary: 'The project is live and being monitored.',
  },
  maintenance: {
    label: 'Maintenance',
    color: '#38bdf8',
    icon: 'settings_suggest',
    progress: 92,
    summary: 'Ongoing support, updates, and improvements.',
  },
  active: {
    label: 'Active',
    color: '#34d399',
    icon: 'play_circle',
    progress: 50,
    summary: 'Active project work is underway.',
  },
  on_hold: {
    label: 'On Hold',
    color: '#f59e0b',
    icon: 'pause_circle',
    progress: 25,
    summary: 'Paused until the next input or decision is ready.',
  },
  completed: {
    label: 'Completed',
    color: '#4ade80',
    icon: 'check_circle',
    progress: 100,
    summary: 'Completed and ready for reference.',
  },
  archived: {
    label: 'Archived',
    color: '#94a3b8',
    icon: 'inventory_2',
    progress: 100,
    summary: 'Archived for historical reference.',
  },
  in_progress: {
    label: 'In Progress',
    color: '#34d399',
    icon: 'autorenew',
    progress: 58,
    summary: 'Work is actively moving forward.',
  },
}

function projectMeta(project: ProjectListCardProject) {
  return STATUS_META[project.status] ?? {
    label: project.status.replace(/_/g, ' '),
    color: '#94a3b8',
    icon: 'folder_managed',
    progress: 25,
    summary: 'Project workspace is ready for planning and delivery.',
  }
}

function timestampLabel(value: unknown) {
  if (!value) return 'Timeline pending'
  let date: Date | null = null
  if (value instanceof Date) date = value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) date = parsed
  }
  if (typeof value === 'object' && value !== null) {
    const timestamp = value as { seconds?: number; _seconds?: number; toDate?: () => Date }
    if (typeof timestamp.toDate === 'function') date = timestamp.toDate()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (!date && typeof seconds === 'number') date = new Date(seconds * 1000)
  }
  if (!date) return 'Timeline pending'
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)}`
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status] ?? { label: status.replace(/_/g, ' '), color: 'var(--color-outline)' }
  return (
    <span
      className="pib-label inline-flex items-center rounded-md px-2 py-1"
      style={{ background: `${s.color}18`, color: s.color, border: `1px solid ${s.color}33` }}
    >
      {s.label}
    </span>
  )
}

export function ProjectListCard({ project, href }: { project: ProjectListCardProject; href: string }) {
  const meta = projectMeta(project)
  const description = project.description?.trim() || meta.summary
  const updated = timestampLabel(project.updatedAt ?? project.createdAt)

  return (
    <Link
      href={href}
      data-module-accent="cyan"
      className="pib-card pib-enter group/card relative flex min-h-[148px] overflow-hidden !p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-pib-cyan)]/50"
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: meta.color }} />
      <div className="flex min-w-0 flex-1 flex-col p-3.5 pl-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="shrink-0" aria-hidden="true">
              <Icon name={meta.icon} />
            </span>
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-sm font-headline font-medium leading-snug text-[var(--color-pib-text)] group-hover/card:text-[var(--color-pib-cyan)]">
                {project.name}
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--color-pib-text-muted)]">{updated}</p>
            </div>
          </div>
          <div className="shrink-0 pr-7">
            <StatusBadge status={project.status} />
          </div>
        </div>

        <p className="mt-2.5 line-clamp-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{description}</p>

        <div className="mt-auto pt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="pib-label">Delivery progress</span>
            <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]">{meta.progress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-md bg-white/[0.06]">
            <div
              className="h-full rounded-md transition-all duration-300"
              style={{ width: `${meta.progress}%`, background: meta.color }}
            />
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1 text-[var(--color-pib-text-muted)]">
              <Icon name="view_kanban" />
              Board workspace
            </span>
            <span className="inline-flex items-center gap-0.5 text-[var(--color-pib-cyan)] opacity-0 transition-opacity group-hover/card:opacity-100">
              Open
              <Icon name="arrow_forward" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
