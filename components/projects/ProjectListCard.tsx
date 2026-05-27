'use client'

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
      className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-label uppercase tracking-wide"
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
      className="group/card relative flex min-h-[178px] overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-pib-accent)]/60 hover:shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: meta.color }} />
      <div className="flex min-w-0 flex-1 flex-col p-5 pl-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
              style={{ color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}24` }}
            >
              <span className="material-symbols-outlined block text-[20px] leading-none">{meta.icon}</span>
            </span>
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-base font-headline font-semibold leading-snug text-on-surface group-hover/card:text-[var(--color-pib-accent-hover)]">
                {project.name}
              </h3>
              <p className="mt-1 text-xs text-on-surface-variant">{updated}</p>
            </div>
          </div>
          <div className="shrink-0 pr-8">
            <StatusBadge status={project.status} />
          </div>
        </div>

        <p className="mt-4 line-clamp-2 text-sm leading-6 text-on-surface-variant">{description}</p>

        <div className="mt-auto pt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Delivery progress</span>
            <span className="font-mono text-[11px] text-on-surface-variant">{meta.progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${meta.progress}%`, background: meta.color }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
              <span className="material-symbols-outlined text-[15px]">view_kanban</span>
              Board workspace
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--color-pib-accent-hover)] opacity-0 transition-opacity group-hover/card:opacity-100">
              Open
              <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
