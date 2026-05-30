'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface OrgSummary {
  id: string
  name: string
  slug?: string
}

interface BriefingCard {
  id: string
  orgId: string
  priority: 'critical' | 'needs-peet' | 'client-risk' | 'review' | 'progress' | 'fyi'
  title: string
  summary: string
  excerpt?: string | null
  timeAgo?: string
  requiresAction?: boolean
  source: { type: string; id: string; url?: string }
  actor: { id: string; name?: string | null; role?: string; type?: string }
  context: {
    orgId: string
    orgName?: string | null
    projectId?: string | null
    projectName?: string | null
    taskId?: string | null
    taskTitle?: string | null
    documentId?: string | null
    documentTitle?: string | null
  }
  occurredAt: string
}

interface BriefingFeed {
  items: BriefingCard[]
  total: number
  hasMore: boolean
  generatedAt: string
}

const PRIORITIES = [
  { value: 'all', label: 'All priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'needs-peet', label: 'Needs Peet' },
  { value: 'client-risk', label: 'Client risk' },
  { value: 'review', label: 'Review' },
  { value: 'progress', label: 'Progress' },
  { value: 'fyi', label: 'FYI' },
]

const SOURCES = [
  { value: 'all', label: 'All sources' },
  { value: 'task', label: 'Tasks' },
  { value: 'comment', label: 'Comments' },
  { value: 'agent-output', label: 'Agent output' },
  { value: 'project', label: 'Projects' },
  { value: 'client-document', label: 'Documents' },
  { value: 'approval', label: 'Approvals' },
  { value: 'notification', label: 'Notifications' },
  { value: 'activity', label: 'Activity' },
  { value: 'report', label: 'Reports' },
]

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  'needs-peet': 'Needs Peet',
  'client-risk': 'Client risk',
  review: 'Review',
  progress: 'Progress',
  fyi: 'FYI',
}

function priorityClass(priority: BriefingCard['priority']) {
  switch (priority) {
    case 'critical':
      return 'border-red-500/50 bg-red-500/10 text-red-100'
    case 'needs-peet':
      return 'border-amber-400/50 bg-amber-400/10 text-amber-100'
    case 'client-risk':
      return 'border-orange-400/50 bg-orange-400/10 text-orange-100'
    case 'review':
      return 'border-sky-400/50 bg-sky-400/10 text-sky-100'
    case 'progress':
      return 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100'
    default:
      return 'border-white/10 bg-white/5 text-on-surface-variant'
  }
}

function titledId(title: string | null | undefined, id: string | null | undefined) {
  if (title && id && title === id) return title
  if (title && id) return `${title} (${id})`
  return title ?? id ?? 'Unknown'
}

function sourceLabel(item: BriefingCard) {
  if (item.context.taskTitle) return `${item.source.type} · ${titledId(item.context.taskTitle, item.context.taskId ?? item.source.id)}`
  if (item.context.projectName) return `${item.source.type} · ${titledId(item.context.projectName, item.context.projectId ?? item.source.id)}`
  if (item.context.documentTitle) return `${item.source.type} · ${titledId(item.context.documentTitle, item.context.documentId ?? item.source.id)}`
  return `${item.source.type} · ${item.source.id}`
}

export default function AdminBriefingsPage() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [orgId, setOrgId] = useState('')
  const [priority, setPriority] = useState('all')
  const [sourceType, setSourceType] = useState('all')
  const [feed, setFeed] = useState<BriefingFeed | null>(null)
  const [selected, setSelected] = useState<BriefingCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [snapshotting, setSnapshotting] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/v1/organizations')
        const body = await res.json()
        const rows = (body.data ?? body.organizations ?? body.orgs ?? []) as OrgSummary[]
        setOrgs(rows)
      } catch {
        setOrgs([])
      }
    })()
  }, [])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (orgId) params.set('orgId', orgId)
    if (priority !== 'all') params.set('priority', priority)
    if (sourceType !== 'all') params.set('sourceType', sourceType)
    params.set('limit', '60')
    return params.toString()
  }, [orgId, priority, sourceType])

  const loadFeed = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/briefings/feed?${query}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Briefing feed failed')
      const data = (body.data ?? body) as BriefingFeed
      setFeed(data)
      setSelected((current) => current ?? data.items[0] ?? null)
      setFlash(null)
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Briefing feed failed' })
      setFeed({ items: [], total: 0, hasMore: false, generatedAt: new Date().toISOString() })
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  async function createSnapshot() {
    setSnapshotting(true)
    try {
      const res = await fetch('/api/v1/briefings/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: orgId || undefined, priority, sourceType, limit: 80 }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Snapshot failed')
      setFlash({ kind: 'ok', message: `Snapshot saved: ${body.data?.snapshot?.id ?? 'created'}` })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Snapshot failed' })
    } finally {
      setSnapshotting(false)
    }
  }

  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const item of feed?.items ?? []) result[item.priority] = (result[item.priority] ?? 0) + 1
    return result
  }, [feed])

  return (
    <div className="min-h-screen bg-page text-on-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="pib-card p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand">Admin Briefing</p>
              <h1 className="mt-2 text-3xl font-semibold text-on-surface">Operational teleprompter</h1>
              <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
                A readable stream over Projects/Kanban, agent outputs, approvals, documents, notifications, activity, and reports. The tickets stay the ledger; this is the layer humans can actually read.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="pib-btn-secondary" type="button" onClick={loadFeed} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh feed'}
              </button>
              <button className="pib-btn-primary" type="button" onClick={createSnapshot} disabled={snapshotting}>
                {snapshotting ? 'Saving…' : 'Save snapshot'}
              </button>
            </div>
          </div>
          {flash ? (
            <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${flash.kind === 'ok' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100' : 'border-red-400/40 bg-red-400/10 text-red-100'}`}>
              {flash.message}
            </div>
          ) : null}
        </section>

        <section className="pib-card p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-on-surface-variant">
              Workspace
              <select className="pib-input" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
                <option value="">All visible workspaces</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-on-surface-variant">
              Priority
              <select className="pib-input" value={priority} onChange={(event) => setPriority(event.target.value)}>
                {PRIORITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-on-surface-variant">
              Source
              <select className="pib-input" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                {SOURCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-on-surface-variant">
              <p className="font-medium text-on-surface">{feed?.total ?? 0} updates</p>
              <p>{feed?.generatedAt ? `Generated ${new Date(feed.generatedAt).toLocaleString('en-ZA')}` : 'Waiting for feed'}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {PRIORITIES.filter((p) => p.value !== 'all').map((p) => (
                <button key={p.value} type="button" onClick={() => setPriority(p.value)} className={`rounded-2xl border px-4 py-3 text-left text-sm ${priority === p.value ? 'border-brand bg-brand/15 text-on-surface' : 'border-white/10 bg-white/5 text-on-surface-variant'}`}>
                  <span className="block text-xl font-semibold text-on-surface">{counts[p.value] ?? 0}</span>
                  {p.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="pib-card p-6 text-sm text-on-surface-variant">Loading briefing feed…</div>
            ) : (feed?.items.length ?? 0) === 0 ? (
              <div className="pib-card p-6 text-sm text-on-surface-variant">No matching briefing items. Either the platform is quiet, or the filters are too fussy. Miracles happen.</div>
            ) : (
              feed?.items.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelected(item)} className={`pib-card border-l-4 p-5 text-left transition hover:-translate-y-0.5 hover:border-brand/60 ${selected?.id === item.id ? 'ring-2 ring-brand/40' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClass(item.priority)}`}>{PRIORITY_LABELS[item.priority]}</span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-on-surface-variant">{item.source.type}</span>
                    {item.requiresAction ? <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs text-brand">Action</span> : null}
                    <span className="ml-auto text-xs text-on-surface-variant">{item.timeAgo}</span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-on-surface">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">{item.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-on-surface-variant">
                    <span>Workspace: {titledId(item.context.orgName, item.orgId)}</span>
                    {item.context.projectName || item.context.projectId ? <span>Project: {titledId(item.context.projectName, item.context.projectId)}</span> : null}
                    {item.context.taskTitle || item.context.taskId ? <span>Task: {titledId(item.context.taskTitle, item.context.taskId)}</span> : null}
                  </div>
                </button>
              ))
            )}
          </div>

          <aside className="pib-card sticky top-4 h-fit p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">Evidence</p>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-on-surface">{selected.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">{selected.excerpt || selected.summary}</p>
                </div>
                <dl className="space-y-3 text-sm">
                  <div><dt className="text-on-surface-variant">Actor</dt><dd className="text-on-surface">{titledId(selected.actor.name, selected.actor.id)}</dd></div>
                  <div><dt className="text-on-surface-variant">Workspace</dt><dd className="text-on-surface">{titledId(selected.context.orgName, selected.orgId)}</dd></div>
                  {selected.context.projectName || selected.context.projectId ? <div><dt className="text-on-surface-variant">Project</dt><dd className="text-on-surface">{titledId(selected.context.projectName, selected.context.projectId)}</dd></div> : null}
                  {selected.context.taskTitle || selected.context.taskId ? <div><dt className="text-on-surface-variant">Task</dt><dd className="text-on-surface">{titledId(selected.context.taskTitle, selected.context.taskId)}</dd></div> : null}
                  {selected.context.documentTitle || selected.context.documentId ? <div><dt className="text-on-surface-variant">Document</dt><dd className="text-on-surface">{titledId(selected.context.documentTitle, selected.context.documentId)}</dd></div> : null}
                  <div><dt className="text-on-surface-variant">Occurred</dt><dd className="text-on-surface">{new Date(selected.occurredAt).toLocaleString('en-ZA')}</dd></div>
                  <div><dt className="text-on-surface-variant">Source</dt><dd className="text-on-surface">{sourceLabel(selected)}</dd></div>
                </dl>
                {selected.source.url ? (
                  <a className="pib-btn-secondary inline-flex w-full justify-center" href={selected.source.url}>Open source</a>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-on-surface-variant">Select an item to inspect its evidence trail.</p>
            )}
          </aside>
        </section>
      </div>
    </div>
  )
}
