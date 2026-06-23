'use client'

import { useCallback, useEffect, useState } from 'react'

interface QueueSummary {
  name: string
  collection: string
  instrumented: boolean
  pending: number
  processing: number
  failed: number
  deliveredLast24h: number
  total: number
  note?: string
}

interface Job {
  id: string
  queue: string
  status: string
  attempts: number | null
  createdAtMs: number | null
  nextAttemptMs: number | null
  orgId: string
  label: string
  isFailed: boolean
}

interface JobsData {
  queues: QueueSummary[]
  recentJobs: Job[]
  deadLetter: Job[]
}

interface ThroughputBucket {
  hourStart: string
  delivered: number
  failed: number
}

interface SessionInfo {
  isSuperAdmin?: boolean
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function fmtTime(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleString()
}

const STATUS_TINT: Record<string, string> = {
  pending: 'text-amber-400',
  scheduled: 'text-amber-400',
  delivering: 'text-blue-400',
  processing: 'text-blue-400',
  delivered: 'text-emerald-400',
  completed: 'text-emerald-400',
  sent: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-on-surface-variant',
}

export default function JobsClient() {
  const [data, setData] = useState<JobsData | null>(null)
  const [throughput, setThroughput] = useState<ThroughputBucket[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [jobsRes, tpRes] = await Promise.all([
        fetch('/api/v1/admin/system/jobs'),
        fetch('/api/v1/admin/system/jobs/throughput'),
      ])
      const jobsBody = await jobsRes.json()
      const tpBody = await tpRes.json()
      if (!jobsRes.ok) throw new Error(jobsBody?.error || 'Failed to load jobs')
      setData(jobsBody.data ?? jobsBody)
      setThroughput((tpBody.data ?? tpBody)?.buckets ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SessionInfo | null) => { if (!cancelled) setIsSuperAdmin(Boolean(s?.isSuperAdmin)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  async function act(job: Job, action: 'retry' | 'cancel') {
    setBusy(`${action}:${job.id}`)
    try {
      const res = await fetch(`/api/v1/admin/system/jobs/${job.id}/${action}?queue=${job.queue}`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `${action} failed`)
      setToast(`${action === 'retry' ? 'Retried' : 'Cancelled'} ${job.queue}/${job.id.slice(0, 8)}`)
      load()
    } catch (err) {
      setToast(err instanceof Error ? err.message : `${action} failed`)
    } finally {
      setBusy(null)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const maxTp = throughput?.reduce((m, b) => Math.max(m, b.delivered + b.failed), 0) ?? 0

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">System / Ops</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Jobs &amp; Queues</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Live queue depths across the platform&apos;s real Firestore-backed queues, hourly throughput, recent
            jobs, and the dead-letter list. Retry or cancel individual items.
          </p>
        </div>
        <button onClick={load} className="pib-btn-ghost text-sm font-label flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
      </div>

      {toast && <div className="pib-card border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300">{toast}</div>}
      {error && <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>}

      {/* Queue-depth cards */}
      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : data ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.queues.map((q) => (
            <div key={q.collection + q.name} className={`pib-card p-4 ${q.instrumented ? '' : 'opacity-70'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-label text-on-surface">{q.name}</span>
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant/70">
                  {q.instrumented ? 'queue' : 'do_not_disturb_on'}
                </span>
              </div>
              <p className="text-[10px] font-mono text-on-surface-variant mt-0.5">{q.collection}</p>
              {q.instrumented ? (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-semibold text-amber-400">{q.pending}</div>
                      <div className="text-[9px] uppercase tracking-wide text-on-surface-variant">Pending</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-blue-400">{q.processing}</div>
                      <div className="text-[9px] uppercase tracking-wide text-on-surface-variant">Active</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-red-400">{q.failed}</div>
                      <div className="text-[9px] uppercase tracking-wide text-on-surface-variant">Failed</div>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-emerald-400">{q.deliveredLast24h} delivered / 24h</p>
                </>
              ) : (
                <p className="mt-3 text-[11px] text-on-surface-variant">Not instrumented as a queue.</p>
              )}
              {q.note && <p className="mt-2 text-[10px] text-on-surface-variant/80 leading-snug">{q.note}</p>}
            </div>
          ))}
        </section>
      ) : null}

      {/* Throughput chart */}
      <section className="pib-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-label uppercase tracking-wide text-on-surface-variant">Webhook throughput (last 24h)</h2>
          <span className="text-xs text-on-surface-variant">source: webhook_queue.deliveredAt</span>
        </div>
        {loading && !throughput ? (
          <Skeleton className="h-32 mt-3 rounded" />
        ) : throughput && throughput.length > 0 ? (
          <svg viewBox="0 0 600 140" className="w-full mt-3" role="img" aria-label="Hourly throughput">
            {throughput.map((b, i) => {
              const barW = 600 / throughput.length
              const total = b.delivered + b.failed
              const h = maxTp > 0 ? (total / maxTp) * 100 : 0
              const failH = maxTp > 0 ? (b.failed / maxTp) * 100 : 0
              const x = i * barW
              return (
                <g key={b.hourStart}>
                  <rect x={x + 1} y={120 - h} width={barW - 2} height={h} className="fill-current text-emerald-500/70" rx="1" />
                  {b.failed > 0 && (
                    <rect x={x + 1} y={120 - failH} width={barW - 2} height={failH} className="fill-current text-red-500/80" rx="1" />
                  )}
                </g>
              )
            })}
            <line x1="0" y1="120" x2="600" y2="120" className="stroke-current text-white/10" strokeWidth="1" />
          </svg>
        ) : (
          <p className="mt-3 text-xs text-on-surface-variant">No deliveries in the last 24h.</p>
        )}
        <div className="mt-2 flex gap-4 text-[11px]">
          <span className="text-emerald-400">● delivered</span>
          <span className="text-red-400">● failed</span>
        </div>
      </section>

      {/* Recent jobs table */}
      <section className="pib-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-label uppercase tracking-wide text-on-surface-variant">Recent jobs</h2>
        </div>
        {loading && !data ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</div>
        ) : !data || data.recentJobs.length === 0 ? (
          <div className="p-10 text-center text-sm text-on-surface-variant">No queue items found.</div>
        ) : (
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-pib-bg)]">
                <tr className="text-left text-on-surface-variant border-b border-white/10">
                  <th className="px-3 py-2 font-label">Queue</th>
                  <th className="px-3 py-2 font-label">Item</th>
                  <th className="px-3 py-2 font-label">Status</th>
                  <th className="px-3 py-2 font-label">Attempts</th>
                  <th className="px-3 py-2 font-label">Created</th>
                  <th className="px-3 py-2 font-label">Next attempt</th>
                  <th className="px-3 py-2 font-label"></th>
                </tr>
              </thead>
              <tbody>
                {data.recentJobs.map((j) => (
                  <tr key={j.queue + j.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-mono text-on-surface-variant">{j.queue}</td>
                    <td className="px-3 py-2 text-on-surface truncate max-w-[160px]" title={j.label}>{j.label}</td>
                    <td className={`px-3 py-2 font-mono ${STATUS_TINT[j.status] ?? 'text-on-surface'}`}>{j.status}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{j.attempts ?? '—'}</td>
                    <td className="px-3 py-2 text-on-surface-variant whitespace-nowrap">{fmtTime(j.createdAtMs)}</td>
                    <td className="px-3 py-2 text-on-surface-variant whitespace-nowrap">{fmtTime(j.nextAttemptMs)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isSuperAdmin && j.status !== 'cancelled' && (
                        <div className="flex gap-1 justify-end">
                          {j.isFailed && (
                            <button onClick={() => act(j, 'retry')} disabled={busy === `retry:${j.id}`} className="pib-btn-ghost text-[11px] font-label disabled:opacity-50">
                              {busy === `retry:${j.id}` ? '...' : 'Retry'}
                            </button>
                          )}
                          {(j.status === 'pending' || j.status === 'scheduled') && (
                            <button onClick={() => act(j, 'cancel')} disabled={busy === `cancel:${j.id}`} className="pib-btn-ghost text-[11px] font-label text-red-400 disabled:opacity-50">
                              {busy === `cancel:${j.id}` ? '...' : 'Cancel'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Dead-letter list */}
      <section className="pib-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-sm font-label uppercase tracking-wide text-on-surface-variant">Dead-letter (failed items)</h2>
          {data && <span className="text-xs text-red-400">{data.deadLetter.length}</span>}
        </div>
        {!data || data.deadLetter.length === 0 ? (
          <div className="p-8 text-center text-sm text-on-surface-variant">No failed jobs. Clean queues.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {data.deadLetter.map((j) => (
              <div key={j.queue + j.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <span className="font-mono text-on-surface-variant w-28 shrink-0">{j.queue}</span>
                <span className="text-on-surface flex-1 truncate" title={j.label}>{j.label}</span>
                <span className="text-on-surface-variant whitespace-nowrap">{fmtTime(j.createdAtMs)}</span>
                {isSuperAdmin && (
                  <button onClick={() => act(j, 'retry')} disabled={busy === `retry:${j.id}`} className="pib-btn-ghost text-[11px] font-label disabled:opacity-50">
                    {busy === `retry:${j.id}` ? '...' : 'Retry'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
