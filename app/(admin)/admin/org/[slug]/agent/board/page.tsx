'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { AgentId, AgentTaskCard } from '@/lib/agent-board/types'
import {
  AGENT_BOARD_OPERATIONAL_VIEWS,
  getAgentBoardBadges,
  getAgentBoardFilterCounts,
  matchesAgentBoardView,
  type AgentBoardBadgeTone,
  type AgentBoardOperationalView,
} from '@/lib/agent-board/filters'
import { TaskDetailModal } from '@/components/agent-board/TaskDetailModal'
import { EmptyState } from '@/components/agent-board/EmptyState'

const ALL_AGENTS: AgentId[] = ['pip', 'theo', 'maya', 'sage', 'nora']

type BoardResponse = {
  orgId: string
  orgSlug: string | null
  orgName: string | null
  orgNames?: Record<string, string>
  total: number
  byStatus: Record<string, number>
  statusOrder: string[]
  cards: AgentTaskCard[]
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

const STATUS_COLORS: Record<string, string> = {
  pending: 'border-amber-500/40 bg-amber-500/5',
  'picked-up': 'border-blue-500/40 bg-blue-500/5',
  'in-progress': 'border-indigo-500/40 bg-indigo-500/5',
  'awaiting-input': 'border-orange-500/40 bg-orange-500/5',
  done: 'border-emerald-500/40 bg-emerald-500/5',
  blocked: 'border-rose-500/40 bg-rose-500/5',
  unstarted: 'border-white/10 bg-white/[0.02]',
}

const AGENT_COLORS: Record<AgentId, string> = {
  pip: 'bg-amber-400/15 text-amber-200 border border-amber-400/30',
  theo: 'bg-sky-400/15 text-sky-200 border border-sky-400/30',
  maya: 'bg-fuchsia-400/15 text-fuchsia-200 border border-fuchsia-400/30',
  sage: 'bg-emerald-400/15 text-emerald-200 border border-emerald-400/30',
  nora: 'bg-slate-300/15 text-slate-200 border border-slate-300/30',
}

const BADGE_TONE_CLASSES: Record<AgentBoardBadgeTone, string> = {
  agent: 'bg-white/10 text-on-surface border-white/15 capitalize',
  danger: 'bg-rose-500/15 text-rose-200 border-rose-400/30',
  warning: 'bg-orange-500/15 text-orange-200 border-orange-400/30',
  info: 'bg-sky-500/15 text-sky-200 border-sky-400/30',
  purple: 'bg-purple-500/15 text-purple-200 border-purple-400/30',
  neutral: 'bg-slate-400/15 text-slate-200 border-slate-300/30',
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

export default function AgentBoardPage() {
  const params = useParams()
  const slug = params.slug as string

  const [data, setData] = useState<BoardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agentFilter, setAgentFilter] = useState<AgentId | 'all'>('all')
  const [viewFilter, setViewFilter] = useState<AgentBoardOperationalView>('all')
  const [selected, setSelected] = useState<AgentTaskCard | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ orgSlug: slug })
      if (agentFilter !== 'all') qs.set('assigneeAgentId', agentFilter)
      const res = await fetch(`/api/v1/admin/agent-tasks?${qs.toString()}`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setData(body.data as BoardResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [slug, agentFilter])

  useEffect(() => {
    if (!slug) return
    void load()
  }, [slug, load])

  useEffect(() => {
    if (!slug) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void load()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const id = setInterval(tick, 15000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [slug, load])

  const filteredCards = useMemo(() => data?.cards.filter((card) => matchesAgentBoardView(card, viewFilter)) ?? [], [data, viewFilter])
  const viewCounts = useMemo(() => getAgentBoardFilterCounts(data?.cards ?? []), [data])
  const orgNames = data?.orgNames ?? {}
  const currentOrgId = data?.orgId ?? null

  const columns = useMemo(() => {
    if (!data) return []
    const cols = data.statusOrder.map((status) => ({
      status,
      label: STATUS_LABELS[status] ?? status,
      cards: filteredCards.filter((c) => c.agentStatus === status),
    }))
    const unstarted = filteredCards.filter((c) => !c.agentStatus || !data.statusOrder.includes(c.agentStatus))
    if (unstarted.length > 0) {
      cols.unshift({ status: 'unstarted', label: STATUS_LABELS.unstarted, cards: unstarted })
    }
    return cols
  }, [data, filteredCards])

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-on-surface">Agent Board</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Every task across <span className="font-medium">{data?.orgName ?? slug}</span> that has an agent assigned —
            both project-nested and standalone. Grouped by agent status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.02] p-1">
            <button
              onClick={() => setAgentFilter('all')}
              className={`text-xs px-3 py-1 rounded-full transition ${
                agentFilter === 'all' ? 'bg-white/15 text-on-surface' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All agents
            </button>
            {ALL_AGENTS.map((a) => (
              <button
                key={a}
                onClick={() => setAgentFilter(a)}
                className={`text-xs px-3 py-1 rounded-full capitalize transition ${
                  agentFilter === a ? AGENT_COLORS[a] : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.04] text-on-surface-variant hover:text-on-surface hover:bg-white/[0.08] disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <span className="text-[10px] text-on-surface-variant/60">auto-refresh 15s</span>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          Failed to load: {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="text-on-surface font-medium">{filteredCards.length}</span>
            shown
            <span className="opacity-50">/</span>
            <span className="text-on-surface font-medium">{data.total}</span> agent-touched tasks
            <span className="opacity-50">·</span>
            {Object.entries(data.byStatus)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <span key={k}>
                  {STATUS_LABELS[k] ?? k} <span className="font-medium text-on-surface">{n}</span>
                </span>
              ))
              .reduce<React.ReactNode[]>(
                (acc, el, i) => (i === 0 ? [el] : [...acc, <span key={`sep-${i}`} className="opacity-50">·</span>, el]),
                [],
              )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-on-surface-variant/70">Operational view</span>
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
              {AGENT_BOARD_OPERATIONAL_VIEWS.map((view) => {
                const active = viewFilter === view.id
                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setViewFilter(view.id)}
                    className={`text-xs px-2.5 py-1 rounded-md transition ${
                      active ? 'bg-white/15 text-on-surface' : 'text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06]'
                    }`}
                    title={view.label}
                  >
                    <span>{view.shortLabel}</span>
                    <span className="ml-1.5 text-[10px] opacity-70">{viewCounts[view.id] ?? 0}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-flow-col auto-cols-[minmax(280px,1fr)] gap-3 overflow-x-auto pb-3">
        {columns.map((col) => (
          <section
            key={col.status}
            className={`flex flex-col rounded-lg border ${STATUS_COLORS[col.status] ?? STATUS_COLORS.unstarted}`}
          >
            <header className="flex items-center justify-between px-3 py-2 border-b border-white/5">
              <h2 className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                {col.label}
              </h2>
              <span className="text-xs text-on-surface-variant">{col.cards.length}</span>
            </header>
            <div className="flex-1 flex flex-col gap-2 p-2 min-h-[80px]">
              {col.cards.length === 0 && (
                <div className="text-center text-xs text-on-surface-variant/60 py-6">No cards</div>
              )}
              {col.cards.map((card) => {
                const badges = getAgentBoardBadges(card)
                const cardInner = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium text-on-surface leading-snug">{card.title}</h3>
                    </div>

                    {badges.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {badges.map((badge) => (
                          <span
                            key={badge.id}
                            title={badge.title}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${BADGE_TONE_CLASSES[badge.tone]}`}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {card.agentInputSpec && (
                      <p className="mt-1.5 text-xs text-on-surface-variant line-clamp-2">{card.agentInputSpec}</p>
                    )}

                    {card.agentOutputSummary && (
                      <p className="mt-1.5 text-xs text-emerald-200/80 line-clamp-2">
                        <span className="opacity-70">Output: </span>
                        {card.agentOutputSummary}
                      </p>
                    )}

                    <div className="mt-2 flex items-center gap-2 flex-wrap text-[10px] text-on-surface-variant">
                      {card.projectName ? (
                        <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                          <span className="opacity-60">project · </span>
                          {card.projectName}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 opacity-70">
                          standalone
                        </span>
                      )}
                      {orgNames[card.orgId] && card.orgId !== currentOrgId && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-400/20 text-purple-100">
                          <span className="opacity-60">org · </span>
                          {orgNames[card.orgId]}
                        </span>
                      )}
                      {card.priority && card.priority !== 'normal' && card.priority !== 'medium' && (
                        <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 capitalize">
                          {card.priority}
                        </span>
                      )}
                      {card.tags.slice(0, 3).map((t) => (
                        <span key={t} className="opacity-70">#{t}</span>
                      ))}
                      <span className="ml-auto opacity-60">{formatRel(card.updatedAt)}</span>
                    </div>
                  </>
                )

                return (
                  <article
                    key={card.id}
                    className="rounded-md border border-white/10 bg-surface-container-low p-3 hover:bg-surface-container transition cursor-pointer"
                  >
                    {card.source === 'project' ? (
                      <Link href={card.href} className="block focus:outline-none">
                        {cardInner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelected(card)}
                        className="text-left w-full focus:outline-none focus:ring-2 focus:ring-amber-400/40 rounded-md"
                      >
                        {cardInner}
                      </button>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {!loading && data && data.total === 0 && <EmptyState slug={slug} />}

      <TaskDetailModal task={selected} onClose={() => setSelected(null)} slug={slug} />
    </div>
  )
}
