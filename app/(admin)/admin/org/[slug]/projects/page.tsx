'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface Project {
  id: string
  name: string
  status: string
  description?: string
  createdAt?: unknown
  updatedAt?: unknown
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const STATUS_OPTIONS = ['discovery', 'design', 'development', 'review', 'live', 'maintenance']

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

function projectMeta(project: Project) {
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

function ProjectCard({ project, slug }: { project: Project; slug: string }) {
  const meta = projectMeta(project)
  const description = project.description?.trim() || meta.summary
  const updated = timestampLabel(project.updatedAt ?? project.createdAt)

  return (
    <Link
      href={`/admin/org/${slug}/projects/${project.id}`}
      className="group/card relative flex min-h-[178px] overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-pib-accent)]/60 hover:shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: meta.color }} />
      <div className="flex min-w-0 flex-1 flex-col p-5 pl-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="material-symbols-outlined mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[20px]"
              style={{ color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}24` }}
            >
              {meta.icon}
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

export default function ProjectsPage() {
  const params = useParams()
  const slug = params.slug as string
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // New project form state
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formStatus, setFormStatus] = useState('discovery')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/v1/projects?orgSlug=${slug}`)
      .then(r => r.json())
      .then(body => { setProjects(body.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [slug])

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) return

    try {
      setFormError(null)
      setFormLoading(true)

      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          orgSlug: slug,
          status: formStatus,
        }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to create project')
      }

      // Refetch the full list so the new project is confirmed from the server
      const listRes = await fetch(`/api/v1/projects?orgSlug=${slug}`)
      const listBody = await listRes.json()
      setProjects(listBody.data ?? [])
      setShowForm(false)
      setFormName('')
      setFormStatus('discovery')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setFormLoading(false)
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setFormName('')
    setFormStatus('discovery')
    setFormError(null)
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/v1/projects?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to delete project')
      }
      setProjects(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      console.error(err)
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Workspace / Projects</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Projects</h1>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="pib-btn-primary text-sm font-label"
          >
            + New Project
          </button>
        )}
      </div>

      {/* New Project Form */}
      {showForm && (
        <div className="pib-card p-4">
          <form onSubmit={handleCreateProject} className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <input
                type="text"
                placeholder="Project name…"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
                disabled={formLoading}
                autoFocus
              />
            </div>
            <select
              value={formStatus}
              onChange={(e) => setFormStatus(e.target.value)}
              className="px-3 py-2 rounded-md text-sm"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
              disabled={formLoading}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button
              type="submit"
              className="pib-btn-primary text-sm font-label"
              disabled={formLoading || !formName.trim()}
            >
              {formLoading ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="pib-btn-secondary text-sm font-label"
              disabled={formLoading}
            >
              Cancel
            </button>
          </form>
          {formError && (
            <p className="text-xs text-[#ef4444] mt-2">{formError}</p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['all', ...STATUS_OPTIONS].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={[
              'text-xs font-label px-3 py-1.5 rounded-[var(--radius-btn)] transition-colors capitalize',
              filter === s
                ? 'text-black font-medium'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container',
            ].join(' ')}
            style={filter === s ? { background: 'var(--color-accent-v2)' } : {}}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-card-border)] bg-[var(--color-card)] px-6 py-12 text-center">
          <span className="material-symbols-outlined mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-pib-accent-soft)] text-[22px] text-[var(--color-pib-accent)]">
            folder_managed
          </span>
          <p className="font-medium text-on-surface">No projects found</p>
          <p className="mt-1 text-sm text-on-surface-variant">Try another stage filter or create a new client project.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(project => (
            <div key={project.id} className="relative group">
              <ProjectCard project={project} slug={slug} />

              {/* Delete button — appears on hover */}
              {confirmId === project.id ? (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-[var(--color-surface)] border border-[#ef4444] rounded-md px-2 py-1 shadow-sm z-10">
                  <span className="text-[11px] text-[#ef4444]">Delete?</span>
                  <button
                    onClick={() => handleDelete(project.id)}
                    disabled={deletingId === project.id}
                    className="text-[11px] font-medium text-[#ef4444] hover:underline disabled:opacity-50"
                  >
                    {deletingId === project.id ? '…' : 'Yes'}
                  </button>
                  <span className="text-[11px] text-on-surface-variant">/</span>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-[11px] text-on-surface-variant hover:text-on-surface"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.preventDefault(); setConfirmId(project.id) }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[#ef444420] text-[#ef4444]"
                  title="Delete project"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
