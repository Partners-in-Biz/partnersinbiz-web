'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { AgentTaskCard } from '@/lib/agent-board/types'
import { buildBlockedTaskRecovery } from '@/lib/projects/blockerRecovery'

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
  onRefresh?: () => void
  slug: string
}

export function TaskDetailModal({ task, onClose, onRefresh, slug }: Props) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  useEffect(() => {
    if (!task) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [task, onClose])

  useEffect(() => {
    setRetryError(null)
    setRetrying(false)
  }, [task?.id])

  const blockerRecovery = useMemo(() => {
    if (!task) return null
    return buildBlockedTaskRecovery({
      id: task.id,
      title: task.title,
      columnId: task.columnId,
      agentStatus: task.agentStatus,
      assigneeAgentId: task.assigneeAgentId,
      agentInput: task.agentInputSpec ? { spec: task.agentInputSpec } : null,
      agentOutput: task.agentOutputSummary ? { summary: task.agentOutputSummary } : null,
      dependsOn: task.dependsOn,
      labels: task.labels,
    })
  }, [task])

  if (!task) return null

  const statusLabel = task.agentStatus ? STATUS_LABELS[task.agentStatus] ?? task.agentStatus : 'No status'
  const canRetry = task.source === 'standalone' && Boolean(blockerRecovery?.isBlocked)

  const handleRetryTask = async () => {
    if (!canRetry || retrying) return
    setRetrying(true)
    setRetryError(null)
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: 'todo' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success === false) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      onRefresh?.()
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error))
    } finally {
      setRetrying(false)
    }
  }

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

        {blockerRecovery?.isBlocked && (
          <section className="mt-4 rounded-md border border-orange-500/25 bg-orange-500/5 p-3 text-xs text-on-surface-variant">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-orange-300">Unblock guidance</h3>
              {canRetry && (
                <button
                  type="button"
                  onClick={handleRetryTask}
                  disabled={retrying}
                  className="inline-flex items-center gap-1 rounded bg-orange-500/20 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-orange-300 transition hover:bg-orange-500/30 disabled:opacity-40"
                  title="Move back to To Do and let it be tried again"
                >
                  <span className="material-symbols-outlined text-[12px]" aria-hidden="true">replay</span>
                  {retrying ? 'Trying...' : 'Try again'}
                </button>
              )}
            </div>
            <div className="mt-2 space-y-1.5">
              <p><span className="text-on-surface">What is wrong:</span> {blockerRecovery.whatIsWrong}</p>
              <p><span className="text-on-surface">Who/what can unblock:</span> {blockerRecovery.whoCanUnblock}</p>
              <p><span className="text-on-surface">Proof needed:</span> {blockerRecovery.requiredEvidence}</p>
              <p><span className="text-on-surface">Message for agent:</span> {blockerRecovery.messageForAgent}</p>
              {retryError && (
                <p className="rounded border border-red-500/20 bg-red-500/10 p-2 text-red-300">{retryError}</p>
              )}
            </div>
          </section>
        )}

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
