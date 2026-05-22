'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import type { AgentId, AgentTaskCard } from '@/lib/agent-board/types'

const AGENT_COLORS: Record<string, string> = {
  pip: 'bg-amber-400/15 text-amber-200 border border-amber-400/30',
  theo: 'bg-sky-400/15 text-sky-200 border border-sky-400/30',
  maya: 'bg-fuchsia-400/15 text-fuchsia-200 border border-fuchsia-400/30',
  sage: 'bg-emerald-400/15 text-emerald-200 border border-emerald-400/30',
  nora: 'bg-slate-300/15 text-slate-200 border border-slate-300/30',
  ads: 'bg-amber-400/15 text-amber-200 border border-amber-400/30',
  'qa-release': 'bg-emerald-400/15 text-emerald-200 border border-emerald-400/30',
  support: 'bg-sky-400/15 text-sky-200 border border-sky-400/30',
  data: 'bg-violet-400/15 text-violet-200 border border-violet-400/30',
  docs: 'bg-rose-400/15 text-rose-200 border border-rose-400/30',
  seo: 'bg-emerald-400/15 text-emerald-200 border border-emerald-400/30',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending pickup',
  'picked-up': 'Picked up',
  'in-progress': 'In progress',
  'awaiting-input': 'Awaiting input',
  done: 'Done',
  blocked: 'Blocked',
  unstarted: 'No status',
}

function formatRel(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const s = Math.round(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

type Props = {
  task: AgentTaskCard | null
  onClose: () => void
  slug: string
}

export function TaskDetailModal({ task, onClose, slug }: Props) {
  useEffect(() => {
    if (!task) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [task, onClose])

  if (!task) return null

  const statusLabel = task.agentStatus ? STATUS_LABELS[task.agentStatus] ?? task.agentStatus : 'No status'

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        className="fixed inset-y-0 right-0 w-full max-w-[480px] bg-surface border-l border-white/10 z-50 overflow-y-auto p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-medium text-on-surface leading-snug">{task.title}</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-on-surface-variant hover:text-on-surface hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="mt-4 first:mt-0 flex items-center gap-2 flex-wrap">
          {task.assigneeAgentId && (
            <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${AGENT_COLORS[task.assigneeAgentId] ?? 'bg-white/10 text-on-surface border border-white/15'}`}>
              {task.assigneeAgentId}
            </span>
          )}
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-on-surface-variant">
            {statusLabel}
          </span>
        </div>

        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">Input spec</h3>
          {task.agentInputSpec ? (
            <p className="mt-1.5 text-sm text-on-surface-variant whitespace-pre-wrap">{task.agentInputSpec}</p>
          ) : (
            <p className="mt-1.5 text-sm text-on-surface-variant/60 italic">(no input spec)</p>
          )}
        </section>

        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">Output</h3>
          {task.agentOutputSummary ? (
            <p className="mt-1.5 text-sm text-on-surface-variant whitespace-pre-wrap">{task.agentOutputSummary}</p>
          ) : (
            <p className="mt-1.5 text-sm text-on-surface-variant/60 italic">(no output yet)</p>
          )}
        </section>

        {task.projectId && task.projectName && (
          <section className="mt-4 text-sm text-on-surface-variant">
            Project:{' '}
            <Link
              href={`/admin/org/${slug}/projects/${task.projectId}`}
              className="text-amber-200 hover:underline"
            >
              {task.projectName}
            </Link>
          </section>
        )}

        <section className="mt-4 flex items-center gap-2 flex-wrap text-[11px] text-on-surface-variant">
          {task.tags.map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
              #{t}
            </span>
          ))}
          {task.priority && (
            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 capitalize">
              {task.priority}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 capitalize">
            {task.source}
          </span>
          {task.createdAt && <span className="opacity-70">created {formatRel(task.createdAt)}</span>}
          {task.updatedAt && <span className="opacity-70">· updated {formatRel(task.updatedAt)}</span>}
        </section>
      </aside>
    </>
  )
}
