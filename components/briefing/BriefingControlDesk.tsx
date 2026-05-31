'use client'

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
    orgSlug?: string | null
    projectId?: string | null
    projectName?: string | null
    taskId?: string | null
    taskTitle?: string | null
    documentId?: string | null
    documentTitle?: string | null
    conversationId?: string | null
    conversationTitle?: string | null
  }
  metadata?: Record<string, unknown> | null
  occurredAt: string
}

interface BriefingFeed {
  items: BriefingCard[]
  total: number
  hasMore: boolean
  generatedAt: string
}

type Mode = 'admin' | 'portal'
type Flash = { kind: 'ok' | 'error'; message: string } | null

const PRIORITIES = [
  { value: 'all', label: 'All priorities', icon: 'select_all' },
  { value: 'critical', label: 'Blocked', icon: 'priority_high' },
  { value: 'needs-peet', label: 'Needs Peet', icon: 'person_alert' },
  { value: 'client-risk', label: 'Risk', icon: 'release_alert' },
  { value: 'review', label: 'Review', icon: 'rate_review' },
  { value: 'progress', label: 'In motion', icon: 'motion_photos_auto' },
  { value: 'fyi', label: 'Changed', icon: 'history' },
]

const SOURCES = [
  { value: 'all', label: 'All sources' },
  { value: 'task', label: 'Tasks' },
  { value: 'comment', label: 'Comments' },
  { value: 'agent-output', label: 'Agent output' },
  { value: 'project', label: 'Projects' },
  { value: 'client-document', label: 'Documents' },
  { value: 'social-post', label: 'Social posts' },
  { value: 'approval', label: 'Approvals' },
  { value: 'notification', label: 'Notifications' },
  { value: 'activity', label: 'Activity' },
  { value: 'report', label: 'Reports' },
]

const PRIORITY_LABELS: Record<BriefingCard['priority'], string> = {
  critical: 'Blocked',
  'needs-peet': 'Needs Peet',
  'client-risk': 'Risk',
  review: 'Review',
  progress: 'In motion',
  fyi: 'Changed',
}

function priorityClass(priority: BriefingCard['priority']) {
  switch (priority) {
    case 'critical':
      return 'border-red-400/45 bg-red-500/15 text-red-100'
    case 'needs-peet':
      return 'border-amber-300/45 bg-amber-400/15 text-amber-100'
    case 'client-risk':
      return 'border-orange-300/45 bg-orange-400/15 text-orange-100'
    case 'review':
      return 'border-sky-300/45 bg-sky-400/15 text-sky-100'
    case 'progress':
      return 'border-emerald-300/45 bg-emerald-400/15 text-emerald-100'
    default:
      return 'border-white/10 bg-white/[0.04] text-on-surface-variant'
  }
}

function titledId(title: string | null | undefined, id: string | null | undefined) {
  if (title && id && title === id) return title
  if (title && id) return `${title} (${id})`
  return title ?? id ?? 'Unknown'
}

function sourceLabel(item: BriefingCard) {
  if (item.context.taskTitle) return `${item.source.type} / ${titledId(item.context.taskTitle, item.context.taskId ?? item.source.id)}`
  if (item.context.projectName) return `${item.source.type} / ${titledId(item.context.projectName, item.context.projectId ?? item.source.id)}`
  if (item.context.documentTitle) return `${item.source.type} / ${titledId(item.context.documentTitle, item.context.documentId ?? item.source.id)}`
  if (item.context.conversationTitle || item.context.conversationId) return `${item.source.type} / ${titledId(item.context.conversationTitle, item.context.conversationId ?? item.source.id)}`
  return `${item.source.type} / ${item.source.id}`
}

function sourceHref(item: BriefingCard, mode: Mode) {
  if (item.source.type === 'social-post') return `/portal/social/review/${encodeURIComponent(item.source.id)}`
  if (mode === 'admin') return item.source.url || null
  if (item.source.url?.startsWith('/portal')) return item.source.url
  if (item.context.conversationId) return `/portal/conversations?convId=${encodeURIComponent(item.context.conversationId)}`
  if (item.context.projectId) return `/portal/projects/${item.context.projectId}${item.context.taskId ? `?taskId=${encodeURIComponent(item.context.taskId)}` : ''}`
  if (item.context.documentId) return `/portal/documents/${item.context.documentId}`
  return item.source.url || null
}

function adminSourceHref(item: BriefingCard) {
  if (item.context.conversationId) {
    const query = `convId=${encodeURIComponent(item.context.conversationId)}`
    if (item.context.orgSlug) return `/admin/org/${item.context.orgSlug}/messages?${query}`
    return `/admin/communications?${query}`
  }
  if (item.source.type === 'social-post') {
    if (socialActionStage(item) === 'qa') return `/admin/social/qa/${encodeURIComponent(item.source.id)}`
    if (item.context.orgSlug) return `/admin/org/${item.context.orgSlug}/social/${encodeURIComponent(item.source.id)}`
    return `/admin/social?postId=${encodeURIComponent(item.source.id)}`
  }
  return item.source.url || null
}

function canTaskAct(item: BriefingCard) {
  return Boolean(item.context.projectId && item.context.taskId)
}

function canDocumentAct(item: BriefingCard) {
  return Boolean(item.context.documentId)
}

function canConversationAct(item: BriefingCard) {
  return Boolean(item.context.conversationId)
}

function canSocialPostAct(item: BriefingCard) {
  return item.source.type === 'social-post' && Boolean(item.source.id)
}

function socialActionStage(item: BriefingCard): 'client' | 'qa' | null {
  const stage = item.metadata?.actionStage
  if (stage === 'client' || stage === 'qa') return stage
  const status = item.metadata?.status
  if (status === 'client_review' || status === 'pending_approval') return 'client'
  if (status === 'qa_review') return 'qa'
  return null
}

function reviewable(item: BriefingCard) {
  return canTaskAct(item) && (item.priority === 'review' || item.source.type === 'agent-output')
}

function documentReviewable(item: BriefingCard) {
  return canDocumentAct(item) && (item.source.type === 'client-document' || item.source.type === 'approval') && ['needs-peet', 'review'].includes(item.priority)
}

function defaultSnoozeDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

export function BriefingControlDesk({ mode }: { mode: Mode }) {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [orgId, setOrgId] = useState('')
  const [priority, setPriority] = useState('all')
  const [sourceType, setSourceType] = useState('all')
  const [feed, setFeed] = useState<BriefingFeed | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [snapshotting, setSnapshotting] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [replyText, setReplyText] = useState('')
  const [socialChangeText, setSocialChangeText] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [flash, setFlash] = useState<Flash>(null)

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
    params.set('limit', '80')
    return params.toString()
  }, [orgId, priority, sourceType])

  const loadFeed = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const res = await fetch(`/api/v1/briefings/feed?${query}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Briefing feed failed')
      const data = (body.data ?? body) as BriefingFeed
      setFeed(data)
      setSelectedId((current) => current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null)
      setFlash(null)
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Briefing feed failed' })
      if (!quiet) setFeed({ items: [], total: 0, hasMore: false, generatedAt: new Date().toISOString() })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => loadFeed({ quiet: true }), 30_000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, loadFeed])

  const items = useMemo(() => feed?.items ?? [], [feed?.items])
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const item of items) result[item.priority] = (result[item.priority] ?? 0) + 1
    return result
  }, [items])

  const topStats = useMemo(() => ({
    action: items.filter((item) => item.requiresAction).length,
    blocked: counts.critical ?? 0,
    review: counts.review ?? 0,
    agents: items.filter((item) => item.actor.type === 'agent' || item.source.type === 'agent-output').length,
  }), [counts, items])

  const workspacePulse = useMemo(() => {
    const byOrg = new Map<string, {
      id: string
      name: string
      total: number
      action: number
      blocked: number
      review: number
      agents: number
      documents: number
      latestAt: number
    }>()

    for (const org of orgs) {
      byOrg.set(org.id, {
        id: org.id,
        name: org.name,
        total: 0,
        action: 0,
        blocked: 0,
        review: 0,
        agents: 0,
        documents: 0,
        latestAt: 0,
      })
    }

    for (const item of items) {
      const id = item.orgId || item.context.orgId || 'unknown'
      const current = byOrg.get(id) ?? {
        id,
        name: item.context.orgName || id,
        total: 0,
        action: 0,
        blocked: 0,
        review: 0,
        agents: 0,
        documents: 0,
        latestAt: 0,
      }
      current.name = item.context.orgName || current.name
      current.total += 1
      if (item.requiresAction) current.action += 1
      if (item.priority === 'critical') current.blocked += 1
      if (item.priority === 'review' || item.priority === 'needs-peet') current.review += 1
      if (item.actor.type === 'agent' || item.source.type === 'agent-output') current.agents += 1
      if (item.source.type === 'client-document' || item.source.type === 'approval') current.documents += 1
      current.latestAt = Math.max(current.latestAt, new Date(item.occurredAt).getTime())
      byOrg.set(id, current)
    }

    return [...byOrg.values()]
      .filter((row) => row.total > 0 || !orgId)
      .sort((a, b) => b.action - a.action || b.blocked - a.blocked || b.latestAt - a.latestAt || a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [items, orgId, orgs])

  async function createSnapshot() {
    setSnapshotting(true)
    try {
      const res = await fetch('/api/v1/briefings/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: orgId || undefined, priority, sourceType, limit: 100, title: 'Control desk snapshot' }),
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

  async function setItemState(item: BriefingCard, action: 'handled' | 'snoozed' | 'active') {
    setBusyAction(action)
    try {
      const res = await fetch(`/api/v1/briefings/items/${encodeURIComponent(item.id)}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, snoozedUntil: action === 'snoozed' ? defaultSnoozeDate() : undefined }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'State update failed')
      setFeed((current) => current ? { ...current, items: current.items.filter((row) => row.id !== item.id), total: Math.max(0, current.total - 1) } : current)
      setFlash({ kind: 'ok', message: action === 'snoozed' ? 'Snoozed for 24 hours.' : action === 'handled' ? 'Marked handled.' : 'Returned to active.' })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'State update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function replyToTask(item: BriefingCard) {
    if (!canTaskAct(item) || !replyText.trim()) return
    setBusyAction('reply')
    try {
      const res = await fetch(`/api/v1/projects/${item.context.projectId}/tasks/${item.context.taskId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: replyText.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Reply failed')
      setReplyText('')
      setFlash({ kind: 'ok', message: 'Reply posted to the source task.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Reply failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function replyToDocument(item: BriefingCard, text: string) {
    if (!canDocumentAct(item) || !text.trim()) return
    setBusyAction('document-reply')
    try {
      const res = await fetch(`/api/v1/client-documents/${item.context.documentId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Document reply failed')
      setReplyText('')
      setFlash({ kind: 'ok', message: 'Reply posted to the source document.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Document reply failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function replyToConversation(item: BriefingCard, text: string) {
    if (!canConversationAct(item) || !text.trim()) return
    setBusyAction('conversation-reply')
    try {
      const res = await fetch(`/api/v1/conversations/${item.context.conversationId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Conversation reply failed')
      setReplyText('')
      setFlash({ kind: 'ok', message: 'Reply posted to the source conversation.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Conversation reply failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function approveDocument(item: BriefingCard) {
    if (!canDocumentAct(item)) return
    setBusyAction('document-approve')
    try {
      const res = await fetch(`/api/v1/client-documents/${item.context.documentId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorName: 'Briefings control desk' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Document approval failed')
      setFlash({ kind: 'ok', message: 'Document approved from the control desk.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Document approval failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function requestDocumentChanges(item: BriefingCard) {
    const text = replyText.trim() || `Changes requested from the Briefings control desk for ${item.context.documentTitle ?? 'this document'}.`
    await replyToDocument(item, text)
  }

  async function replyToSelected(item: BriefingCard) {
    if (canTaskAct(item)) {
      await replyToTask(item)
      return
    }
    if (canDocumentAct(item)) {
      await replyToDocument(item, replyText)
      return
    }
    if (canConversationAct(item)) {
      await replyToConversation(item, replyText)
    }
  }

  async function taskPatch(item: BriefingCard, body: Record<string, unknown>, success: string) {
    if (!canTaskAct(item)) return
    setBusyAction(success)
    try {
      const res = await fetch(`/api/v1/projects/${item.context.projectId}/tasks/${item.context.taskId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await res.json()
      if (!res.ok) throw new Error(responseBody.error || success)
      setFlash({ kind: 'ok', message: success })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Task update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function socialPostAction(item: BriefingCard, action: 'approve' | 'reject') {
    if (!canSocialPostAct(item)) return
    const stage = socialActionStage(item)
    if (!stage) return
    const reason = socialChangeText.trim()
    if (action === 'reject' && !reason) return

    setBusyAction(`social-${action}`)
    try {
      const routeAction = stage === 'qa'
        ? action === 'approve' ? 'qa-approve' : 'qa-reject'
        : action === 'approve' ? 'client-approve' : 'client-reject'
      const res = await fetch(`/api/v1/social/posts/${encodeURIComponent(item.source.id)}/${routeAction}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Social post action failed')
      setSocialChangeText('')
      setFlash({ kind: 'ok', message: action === 'approve' ? 'Social post approved from the control desk.' : 'Social changes sent back to the agent.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Social post action failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function unblockTask(item: BriefingCard) {
    if (!canTaskAct(item)) return
    setBusyAction('unblock')
    try {
      const res = await fetch(`/api/v1/projects/${item.context.projectId}/tasks/${item.context.taskId}/unblock`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Unblock failed')
      setFlash({ kind: 'ok', message: body.data?.requeued ? 'Unblocked and requeued to the agent.' : 'Unblocked.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Unblock failed' })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="min-h-screen bg-page text-on-surface">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-lg border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.18),transparent_32%),linear-gradient(135deg,rgba(17,24,39,0.94),rgba(11,18,32,0.98))] p-5 shadow-2xl">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(420px,0.8fr)] lg:items-end">
            <div>
              <p className="eyebrow !text-[10px] text-brand">{mode === 'admin' ? 'Admin / Control Desk' : 'Workspace / Control Desk'}</p>
              <h1 className="mt-2 max-w-4xl font-display text-4xl font-semibold text-on-surface sm:text-5xl">Briefings control desk</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-on-surface-variant">
                Live operations across projects, blockers, agent output, approvals, notifications, activity, documents, and reports. Work from the card, then jump to the exact source when deeper context is needed.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Needs action', value: topStats.action, icon: 'bolt' },
                { label: 'Blocked', value: topStats.blocked, icon: 'priority_high' },
                { label: 'For review', value: topStats.review, icon: 'rate_review' },
                { label: 'Agent signals', value: topStats.agents, icon: 'smart_toy' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <span className="material-symbols-outlined text-[18px] text-brand" aria-hidden="true">{stat.icon}</span>
                  <p className="mt-2 text-2xl font-semibold text-on-surface">{stat.value}</p>
                  <p className="text-xs text-on-surface-variant">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {flash ? (
          <div className={`rounded-lg border px-4 py-3 text-sm ${flash.kind === 'ok' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100' : 'border-red-400/40 bg-red-400/10 text-red-100'}`}>
            {flash.message}
          </div>
        ) : null}

        <section className="rounded-lg border border-white/10 bg-[var(--color-pib-surface)] p-4">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.85fr_0.85fr_auto] lg:items-end">
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
            <div className="flex flex-wrap gap-2">
              <button className="pib-btn-secondary" type="button" onClick={() => setAutoRefresh((value) => !value)}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{autoRefresh ? 'sync' : 'sync_disabled'}</span>
                {autoRefresh ? 'Live on' : 'Live off'}
              </button>
              <button className="pib-btn-secondary" type="button" onClick={() => loadFeed()} disabled={loading}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
                {loading ? 'Refreshing' : 'Refresh'}
              </button>
              <button className="pib-btn-primary" type="button" onClick={createSnapshot} disabled={snapshotting}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">bookmark_added</span>
                {snapshotting ? 'Saving' : 'Snapshot'}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[var(--color-pib-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow !text-[10px] text-brand">Workspace pulse</p>
              <p className="mt-1 text-sm text-on-surface-variant">Jump between organisations by action pressure, blockers, document approvals, and agent signals.</p>
            </div>
            {orgId ? (
              <button type="button" className="pib-btn-secondary text-xs" onClick={() => setOrgId('')}>
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">select_all</span>
                All workspaces
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {workspacePulse.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-on-surface-variant">
                Workspace counts will appear when the live feed returns active cards.
              </div>
            ) : workspacePulse.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => setOrgId(workspace.id)}
                aria-label={`Filter to ${workspace.name} workspace`}
                className={`min-h-36 rounded-lg border p-4 text-left transition ${orgId === workspace.id ? 'border-brand bg-brand/15 shadow-lg shadow-brand/10' : 'border-white/10 bg-white/[0.03] hover:border-brand/50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{workspace.name}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">{workspace.total} live cards</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${workspace.action > 0 ? 'bg-amber-300/15 text-amber-100' : 'bg-emerald-300/15 text-emerald-100'}`}>
                    {workspace.action} action
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <span className="rounded-md bg-red-400/10 px-2 py-1 text-red-100">{workspace.blocked} blocked</span>
                  <span className="rounded-md bg-sky-400/10 px-2 py-1 text-sky-100">{workspace.review} review</span>
                  <span className="rounded-md bg-emerald-400/10 px-2 py-1 text-emerald-100">{workspace.agents} agents</span>
                  <span className="rounded-md bg-violet-400/10 px-2 py-1 text-violet-100">{workspace.documents} docs</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_420px]">
          <aside className="rounded-lg border border-white/10 bg-[var(--color-pib-surface)] p-3 xl:sticky xl:top-4 xl:h-fit">
            <p className="eyebrow !text-[10px] px-1">Signal lanes</p>
            <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">
              {PRIORITIES.filter((p) => p.value !== 'all').map((p) => (
                <button key={p.value} type="button" onClick={() => setPriority(p.value)} className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${priority === p.value ? 'border-brand bg-brand/15 text-on-surface' : 'border-white/10 bg-white/[0.03] text-on-surface-variant hover:text-on-surface'}`}>
                  <span className="material-symbols-outlined text-[19px]" aria-hidden="true">{p.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.label}</span>
                    <span className="block text-xs text-on-surface-variant">{counts[p.value] ?? 0} live</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-on-surface-variant">
              <span>{feed?.total ?? 0} live cards</span>
              <span>{feed?.generatedAt ? `Updated ${new Date(feed.generatedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for feed'}</span>
            </div>

            {loading ? (
              <div className="rounded-lg border border-white/10 bg-[var(--color-pib-surface)] p-6 text-sm text-on-surface-variant">Loading live control desk...</div>
            ) : items.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-[var(--color-pib-surface)] p-6 text-sm text-on-surface-variant">No matching cards are active. Handled and snoozed cards stay out of this live view until they return.</div>
            ) : (
              items.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`rounded-lg border border-white/10 bg-[var(--color-pib-surface)] p-4 text-left transition hover:border-brand/60 ${selected?.id === item.id ? 'ring-2 ring-brand/40' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClass(item.priority)}`}>{PRIORITY_LABELS[item.priority]}</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-on-surface-variant">{item.source.type}</span>
                    {item.requiresAction ? <span className="rounded-full border border-brand/35 bg-brand/10 px-2.5 py-1 text-xs text-brand">Action</span> : null}
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

          <aside className="rounded-lg border border-white/10 bg-[var(--color-pib-surface)] p-5 xl:sticky xl:top-4 xl:h-fit">
            <p className="eyebrow !text-[10px] text-brand">Action panel</p>
            {selected ? (
              <div className="mt-4 space-y-5">
                <div>
                  <h2 className="text-xl font-semibold text-on-surface">{selected.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">{selected.excerpt || selected.summary}</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => setItemState(selected, 'handled')} disabled={!!busyAction}>
                    <span className="material-symbols-outlined text-[15px]" aria-hidden="true">done_all</span>
                    Handled
                  </button>
                  <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => setItemState(selected, 'snoozed')} disabled={!!busyAction}>
                    <span className="material-symbols-outlined text-[15px]" aria-hidden="true">snooze</span>
                    Snooze 24h
                  </button>
                  {canTaskAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => unblockTask(selected)} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">play_arrow</span>
                      Unblock
                    </button>
                  ) : null}
                  {reviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => taskPatch(selected, { reviewStatus: 'approved', columnId: 'done', agentStatus: 'done' }, 'Approved and moved to done.')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified</span>
                      Approve
                    </button>
                  ) : null}
                  {reviewable(selected) ? (
                    <button className="pib-btn-secondary col-span-2 justify-center text-xs" type="button" onClick={() => taskPatch(selected, { reviewStatus: 'changes-requested', agentStatus: 'pending', columnId: 'todo' }, 'Sent back to the assigned agent.')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">assignment_return</span>
                      Send back to agent
                    </button>
                  ) : null}
                  {documentReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => approveDocument(selected)} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">approval</span>
                      Approve document
                    </button>
                  ) : null}
                  {documentReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => requestDocumentChanges(selected)} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">edit_note</span>
                      Request changes
                    </button>
                  ) : null}
                  {canSocialPostAct(selected) && socialActionStage(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => socialPostAction(selected, 'approve')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">thumb_up</span>
                      Approve social post
                    </button>
                  ) : null}
                  {canSocialPostAct(selected) && socialActionStage(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => socialPostAction(selected, 'reject')} disabled={!socialChangeText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">thumb_down</span>
                      Request social changes
                    </button>
                  ) : null}
                </div>

                {canSocialPostAct(selected) && socialActionStage(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-social-change">
                      Social change request
                    </label>
                    <textarea
                      id="briefing-social-change"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={socialChangeText}
                      onChange={(event) => setSocialChangeText(event.target.value)}
                      placeholder="Describe what the agent should change before approval..."
                    />
                  </div>
                ) : null}

                {canTaskAct(selected) || canDocumentAct(selected) || canConversationAct(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-reply">
                      {canTaskAct(selected) ? 'Inline task reply' : canDocumentAct(selected) ? 'Inline document reply' : 'Inline conversation reply'}
                    </label>
                    <textarea
                      id="briefing-reply"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder="Reply with a decision, note, or instruction..."
                    />
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => replyToSelected(selected)} disabled={!replyText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">reply</span>
                      {canTaskAct(selected) ? 'Post reply to task' : canDocumentAct(selected) ? 'Post reply to document' : 'Post reply to conversation'}
                    </button>
                  </div>
                ) : null}

                <dl className="space-y-3 text-sm">
                  <div><dt className="text-on-surface-variant">Actor</dt><dd className="text-on-surface">{titledId(selected.actor.name, selected.actor.id)}</dd></div>
                  <div><dt className="text-on-surface-variant">Workspace</dt><dd className="text-on-surface">{titledId(selected.context.orgName, selected.orgId)}</dd></div>
                  {selected.context.projectName || selected.context.projectId ? <div><dt className="text-on-surface-variant">Project</dt><dd className="text-on-surface">{titledId(selected.context.projectName, selected.context.projectId)}</dd></div> : null}
                  {selected.context.taskTitle || selected.context.taskId ? <div><dt className="text-on-surface-variant">Task</dt><dd className="text-on-surface">{titledId(selected.context.taskTitle, selected.context.taskId)}</dd></div> : null}
                  {selected.context.documentTitle || selected.context.documentId ? <div><dt className="text-on-surface-variant">Document</dt><dd className="text-on-surface">{titledId(selected.context.documentTitle, selected.context.documentId)}</dd></div> : null}
                  {selected.context.conversationTitle || selected.context.conversationId ? <div><dt className="text-on-surface-variant">Conversation</dt><dd className="text-on-surface">{titledId(selected.context.conversationTitle, selected.context.conversationId)}</dd></div> : null}
                  <div><dt className="text-on-surface-variant">Occurred</dt><dd className="text-on-surface">{new Date(selected.occurredAt).toLocaleString('en-ZA')}</dd></div>
                  <div><dt className="text-on-surface-variant">Source</dt><dd className="text-on-surface">{sourceLabel(selected)}</dd></div>
                </dl>

                {(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode)) ? (
                  <a className="pib-btn-primary inline-flex w-full justify-center" href={(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode)) ?? undefined}>
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span>
                    Open source
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-on-surface-variant">Select a live card to inspect evidence and act on the source.</p>
            )}
          </aside>
        </section>
      </div>
    </div>
  )
}
