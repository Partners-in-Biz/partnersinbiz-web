'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Property } from '@/lib/properties/types'
import type { PropertyStatus } from '@/lib/properties/types'
import { copyToClipboard } from '@/lib/utils/clipboard'
import { PageHeader, PageTabs } from '@/components/ui/AppFoundation'

type Tab = 'overview' | 'config' | 'sequences' | 'creators' | 'analytics' | 'keys'
type TimestampLike = string | number | Date | { _seconds?: number; seconds?: number } | null | undefined
type ApiDataList<T> = { data?: T[] }
type ApiData<T> = { data?: T | null }

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',   label: 'Overview' },
  { id: 'config',     label: 'Config' },
  { id: 'sequences',  label: 'Sequences' },
  { id: 'creators',   label: 'Creators' },
  { id: 'analytics',  label: 'Analytics' },
  { id: 'keys',       label: 'Keys' },
]

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function timestampSeconds(ts: unknown): number {
  if (!ts || typeof ts !== 'object' || ts instanceof Date) return 0
  const candidate = ts as { _seconds?: unknown; seconds?: unknown }
  return typeof candidate._seconds === 'number'
    ? candidate._seconds
    : typeof candidate.seconds === 'number'
      ? candidate.seconds
      : 0
}

function formatTs(ts: unknown): string {
  if (!ts) return ' - '
  const seconds = timestampSeconds(ts)
  const d = seconds ? new Date(seconds * 1000) : new Date(ts as string | number | Date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({ property }: { property: Property }) {
  return (
    <div className="space-y-4">
      <div className="pib-card p-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Name</p>
          <p className="text-[var(--color-pib-text)] font-medium">{property.name}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Domain</p>
          <p className="text-[var(--color-pib-text)] font-medium">{property.domain}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Type</p>
          <p className="text-[var(--color-pib-text)]">{property.type}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Status</p>
          <p className="text-[var(--color-pib-text)]">{property.status}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Created</p>
          <p className="text-[var(--color-pib-text)]">{formatTs(property.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Creator Link Prefix</p>
          <p className="text-[var(--color-pib-text)]">{property.creatorLinkPrefix ?? ' - '}</p>
        </div>
      </div>
      <PropertyAnalyticsSummary propertyId={property.id} />
    </div>
  )
}

// ── Property Analytics Summary (Overview) ───────────────────────────────────

interface SessionRow {
  id: string
  distinctId: string
  device: string | null
  country: string | null
  startedAt: TimestampLike
  lastActivityAt: TimestampLike
  eventCount: number
}

function PropertyAnalyticsSummary({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [liveCount, setLiveCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    Promise.allSettled([
      fetch(`/api/v1/analytics/sessions?propertyId=${encodeURIComponent(propertyId)}&limit=100`).then(r => r.ok ? r.json() : Promise.reject(new Error('sessions'))),
      fetch(`/api/v1/analytics/live?propertyId=${encodeURIComponent(propertyId)}`).then(r => r.ok ? r.json() : Promise.reject(new Error('live'))),
    ]).then(([sRes, lRes]) => {
      if (cancelled) return
      const bothFailed = sRes.status === 'rejected' && lRes.status === 'rejected'
      if (bothFailed) { setError(true); setLoading(false); return }
      if (sRes.status === 'fulfilled') setSessions(sRes.value.data ?? [])
      if (lRes.status === 'fulfilled') setLiveCount((lRes.value.events ?? []).length)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [propertyId])

  if (loading) return <Skeleton className="h-24 rounded-md" />
  if (error) return (
    <div className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)]">Analytics not yet collecting.</div>
  )

  const sessionCount = sessions.length
  let topDevice = ' - '
  if (sessionCount > 0) {
    const counts: Record<string, number> = {}
    for (const s of sessions) {
      const d = s.device ?? 'unknown'
      counts[d] = (counts[d] ?? 0) + 1
    }
    topDevice = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  }
  const lastActivityTs = sessions.reduce<TimestampLike>((acc, s) => {
    const sec = timestampSeconds(s.lastActivityAt)
    const accSec = timestampSeconds(acc)
    return sec > accSec ? s.lastActivityAt : acc
  }, null)

  return (
    <div className="pib-card p-4">
      <div className="grid grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Sessions (recent 100)</p>
          <p className="text-[var(--color-pib-text)] font-medium text-lg">{sessionCount}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Live events</p>
          <p className="text-[var(--color-pib-text)] font-medium text-lg">{liveCount}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Top device</p>
          <p className="text-[var(--color-pib-text)] font-medium text-lg">{topDevice}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Last activity</p>
          <p className="text-[var(--color-pib-text)] font-medium text-lg">{formatTs(lastActivityTs)}</p>
        </div>
      </div>
      {sessionCount === 0 && liveCount === 0 && (
        <p className="text-xs text-[var(--color-pib-text-muted)] mt-3">No analytics data yet - install the SDK and start emitting events.</p>
      )}
    </div>
  )
}

// ── Sequences Tab ──────────────────────────────────────────────────────────

interface SequenceSummary {
  id: string
  name: string
  description?: string
  status: 'draft' | 'active' | 'paused' | 'archived' | string
  steps?: unknown[]
}

interface Enrollment {
  id: string
  sequenceId: string
  status: 'active' | 'completed' | 'exited' | string
}

const SEQ_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#10b98122', fg: '#10b981' },
  draft: { bg: '#94a3b822', fg: '#94a3b8' },
  paused: { bg: '#f59e0b22', fg: '#f59e0b' },
  archived: { bg: '#6b728022', fg: '#6b7280' },
}

function SequencesTab({ property, onUpdate }: { property: Property; onUpdate: (updated: Property) => void }) {
  const [orgSequences, setOrgSequences] = useState<SequenceSummary[]>([])
  const [linkedSequence, setLinkedSequence] = useState<SequenceSummary | null>(null)
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const linkedId = property.conversionSequenceId

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    async function load() {
      try {
        const tasks: Promise<unknown>[] = [
          fetch(`/api/v1/sequences?orgId=${encodeURIComponent(property.orgId)}`).then(r => r.ok ? r.json() : { data: [] }),
        ]
        if (linkedId) {
          tasks.push(
            fetch(`/api/v1/sequences/${encodeURIComponent(linkedId)}`).then(r => r.ok ? r.json() : null),
            fetch(`/api/v1/sequence-enrollments?sequenceId=${encodeURIComponent(linkedId)}`).then(r => r.ok ? r.json() : { data: [] }),
          )
        }
        const results = await Promise.all(tasks)
        if (cancelled) return
        const orgList = (results[0] as ApiDataList<SequenceSummary>)?.data ?? []
        setOrgSequences(orgList)
        if (linkedId) {
          const seqBody = results[1] as ApiData<SequenceSummary>
          setLinkedSequence(seqBody?.data ?? null)
          const enrBody = results[2] as ApiDataList<Enrollment>
          setEnrollments(enrBody?.data ?? [])
        } else {
          setLinkedSequence(null)
          setEnrollments([])
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [property.orgId, linkedId])

  async function saveLink(nextId: string | null) {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/properties/${property.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversionSequenceId: nextId }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Save failed')
      onUpdate(body.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton className="h-40 rounded-md" />

  if (!linkedId) {
    const linkable = orgSequences.filter(s => s.status === 'active' || s.status === 'draft')
    return (
      <div className="pib-card p-4 space-y-3">
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Link a conversion sequence to this property. When this property reports a conversion event, contacts will be auto-enrolled into the linked sequence.
        </p>
        <div className="flex items-end gap-3">
          <div>
            <label htmlFor="prop-sequence" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">Sequence</label>
            <select
              id="prop-sequence"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="pib-input text-sm w-72"
            >
              <option value=""> - Select a sequence - </option>
              {linkable.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => selectedId && saveLink(selectedId)}
            disabled={!selectedId || saving}
            className="pib-btn-primary text-sm font-label"
          >
            {saving ? 'Linking…' : 'Link sequence'}
          </button>
        </div>
        {linkable.length === 0 && (
          <p className="text-xs text-[var(--color-pib-text-muted)]">No active or draft sequences found for this org. Create one first under Sequences.</p>
        )}
        {error && <p className="text-sm text-[var(--st-danger)]">{error}</p>}
      </div>
    )
  }

  // Linked
  const stepCount = linkedSequence?.steps?.length ?? 0
  const total = enrollments.length
  const active = enrollments.filter(e => e.status === 'active').length
  const completed = enrollments.filter(e => e.status === 'completed').length
  const exited = enrollments.filter(e => e.status === 'exited').length
  const sc = (linkedSequence && SEQ_STATUS_COLORS[linkedSequence.status]) ?? SEQ_STATUS_COLORS.draft

  return (
    <div className="space-y-4">
      <div className="pib-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-1">Linked sequence</p>
            <h2 className="text-base font-medium text-[var(--color-pib-text)]">{linkedSequence?.name ?? linkedId}</h2>
            {linkedSequence?.description && (
              <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">{linkedSequence.description}</p>
            )}
          </div>
          {linkedSequence && (
            <span
              className="text-[11px] font-label px-2 py-0.5 rounded-md whitespace-nowrap"
              style={{ background: sc.bg, color: sc.fg }}
            >
              {linkedSequence.status}
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--color-pib-text-muted)]">{stepCount} step{stepCount === 1 ? '' : 's'}</p>
        <div className="flex gap-2">
          <Link
            href={`/portal/sequences/${linkedId}`}
            className="pib-btn-secondary text-xs font-label"
          >
            Open sequence →
          </Link>
          <button
            onClick={() => { if (confirm('Unlink this sequence from the property?')) saveLink(null) }}
            disabled={saving}
            className="pib-btn-secondary text-xs font-label"
          >
            {saving ? 'Working…' : 'Unlink'}
          </button>
        </div>
        {error && <p className="text-sm text-[var(--st-danger)]">{error}</p>}
      </div>

      <div className="pib-card p-4">
        <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-3">Enrollments</p>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Total</p>
            <p className="text-[var(--color-pib-text)] font-medium text-lg">{total}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Active</p>
            <p className="text-[var(--color-pib-text)] font-medium text-lg">{active}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Completed</p>
            <p className="text-[var(--color-pib-text)] font-medium text-lg">{completed}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Exited</p>
            <p className="text-[var(--color-pib-text)] font-medium text-lg">{exited}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Creators Tab ──────────────────────────────────────────────────────────

interface CreatorLink {
  id: string
  shortCode: string
  shortUrl: string
  originalUrl: string
  clickCount: number
  createdAt: any
  propertyId?: string
}

function CreatorsTab({ property }: { property: Property }) {
  const [links, setLinks] = useState<CreatorLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  const [originalUrl, setOriginalUrl] = useState('')
  const [customSlug, setCustomSlug] = useState('')
  const [utmSource, setUtmSource] = useState('')
  const [utmMedium, setUtmMedium] = useState('')
  const [utmCampaign, setUtmCampaign] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copiedId, setCopiedId] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/v1/links?propertyId=${encodeURIComponent(property.id)}&limit=100`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('failed')))
      .then(body => { if (!cancelled) { setLinks(body.data ?? []); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Failed to load links'); setLoading(false) } })
    return () => { cancelled = true }
  }, [property.id])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!originalUrl) return
    setSubmitting(true); setError('')
    try {
      const body: Record<string, unknown> = {
        originalUrl,
        propertyId: property.id,
      }
      if (customSlug) body.shortCode = customSlug
      if (utmSource) body.utmSource = utmSource
      if (utmMedium) body.utmMedium = utmMedium
      if (utmCampaign) body.utmCampaign = utmCampaign
      const res = await fetch(`/api/v1/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create link')
      setLinks(prev => [data.data, ...prev])
      setOriginalUrl(''); setCustomSlug(''); setUtmSource(''); setUtmMedium(''); setUtmCampaign('')
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this link? It will stop redirecting immediately.')) return
    try {
      const res = await fetch(`/api/v1/links/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Delete failed')
      }
      setLinks(prev => prev.filter(l => l.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  function truncate(s: string, n = 60): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }

  return (
    <div className="space-y-4">
      <div className="pib-card p-4 space-y-3">
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Creator/affiliate links attributed to this property. Each link gets its own short URL - click counts are tracked automatically.
        </p>
        <div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="pib-btn-secondary text-xs font-label"
          >
            {showForm ? 'Cancel' : '+ New Creator Link'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="space-y-3 pt-2 border-t border-[var(--color-pib-line)]">
            <div>
              <label htmlFor="prop-dest-url" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">Destination URL</label>
              <input
                id="prop-dest-url"
                type="url"
                required
                value={originalUrl}
                onChange={e => setOriginalUrl(e.target.value)}
                placeholder="https://…"
                className="pib-input text-sm w-full"
              />
            </div>
            <div>
              <label htmlFor="prop-custom-slug" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">Custom slug (optional)</label>
              <input
                id="prop-custom-slug"
                type="text"
                value={customSlug}
                onChange={e => setCustomSlug(e.target.value)}
                placeholder={`${property.creatorLinkPrefix ?? ''}…`}
                className="pib-input text-sm w-full"
              />
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
                If left blank, a random short code is generated. The property&apos;s prefix is shown as a UX hint - you don&apos;t have to use it.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="prop-utm-source" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">UTM source</label>
                <input id="prop-utm-source" type="text" value={utmSource} onChange={e => setUtmSource(e.target.value)} className="pib-input text-sm w-full" />
              </div>
              <div>
                <label htmlFor="prop-utm-medium" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">UTM medium</label>
                <input id="prop-utm-medium" type="text" value={utmMedium} onChange={e => setUtmMedium(e.target.value)} className="pib-input text-sm w-full" />
              </div>
              <div>
                <label htmlFor="prop-utm-campaign" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">UTM campaign</label>
                <input id="prop-utm-campaign" type="text" value={utmCampaign} onChange={e => setUtmCampaign(e.target.value)} className="pib-input text-sm w-full" />
              </div>
            </div>
            <button type="submit" disabled={submitting || !originalUrl} className="pib-btn-primary text-sm font-label">
              {submitting ? 'Creating…' : 'Create link'}
            </button>
          </form>
        )}
        {error && <p className="text-sm text-[var(--st-danger)]">{error}</p>}
      </div>

      <div className="pib-card overflow-x-auto">
        {loading ? (
          <div className="p-4"><Skeleton className="h-24 rounded-md" /></div>
        ) : links.length === 0 ? (
          <div className="p-5 text-center text-[var(--color-pib-text-muted)] text-sm">
            No creator links yet. Create one above to get started.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                {['Short URL', 'Destination', 'Clicks', 'Created', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[var(--color-pib-text-muted)] font-label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {links.map(link => (
                <tr key={link.id} className="border-b border-[var(--color-pib-line)]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[var(--color-pib-text)] text-xs">{link.shortUrl}</code>
                      <button
                        type="button"
                        onClick={async () => { await copyToClipboard(link.shortUrl); setCopiedId(link.id); setTimeout(() => setCopiedId(''), 1500) }}
                        className="pib-btn-secondary text-[10px] px-2 py-0.5"
                      >
                        {copiedId === link.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">
                    <span className="truncate inline-block max-w-[24rem]" title={link.originalUrl}>{truncate(link.originalUrl)}</span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-pib-text)]">{link.clickCount}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{formatTs(link.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleDelete(link.id)}
                      className="text-[var(--color-pib-text-muted)] hover:text-[var(--st-danger)] px-2"
                      aria-label="Delete link"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Property Analytics Tab (Module 2) ──────────────────────────────────────

interface AnalyticsEventRow {
  id: string
  event: string
  pageUrl: string | null
  timestamp?: TimestampLike
  serverTime?: TimestampLike
}

interface PropSession extends SessionRow {
  referrer?: string | null
}

function tsToMs(ts: TimestampLike): number | null {
  if (!ts) return null
  const seconds = timestampSeconds(ts)
  if (seconds) return seconds * 1000
  const d = new Date(ts as string | number | Date)
  return isNaN(d.getTime()) ? null : d.getTime()
}

function formatDateTime(ts: TimestampLike): string {
  if (!ts) return ' - '
  const ms = tsToMs(ts)
  if (ms == null) return ' - '
  return new Date(ms).toLocaleString()
}

function PropertyAnalyticsTab({ property }: { property: Property }) {
  const propertyId = property.id

  const [sessions7d, setSessions7d] = useState<PropSession[]>([])
  const [events7d, setEvents7d] = useState<AnalyticsEventRow[]>([])
  const [recentSessions, setRecentSessions] = useState<PropSession[]>([])
  const [liveEvents, setLiveEvents] = useState<AnalyticsEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      fetch(`/api/v1/analytics/sessions?propertyId=${encodeURIComponent(propertyId)}&limit=500`).then(r => r.ok ? r.json() : { data: [] }),
      fetch(`/api/v1/analytics/events?propertyId=${encodeURIComponent(propertyId)}&limit=500`).then(r => r.ok ? r.json() : { data: [] }),
      fetch(`/api/v1/analytics/sessions?propertyId=${encodeURIComponent(propertyId)}&limit=20`).then(r => r.ok ? r.json() : { data: [] }),
    ]).then(([sBig, eBig, sRecent]) => {
      if (cancelled) return
      const sBigData = sBig.status === 'fulfilled' ? ((sBig.value as ApiDataList<PropSession>).data ?? []) : []
      const eBigData = eBig.status === 'fulfilled' ? ((eBig.value as ApiDataList<AnalyticsEventRow>).data ?? []) : []
      const sRecentData = sRecent.status === 'fulfilled' ? ((sRecent.value as ApiDataList<PropSession>).data ?? []) : []
      const cutoff = Date.now() - 7 * 86_400_000
      setSessions7d(sBigData.filter((s: PropSession) => {
        const ms = tsToMs(s.startedAt)
        return ms == null || ms >= cutoff
      }))
      setEvents7d(eBigData.filter((e: AnalyticsEventRow) => {
        const ms = tsToMs(e.timestamp ?? e.serverTime)
        return ms == null || ms >= cutoff
      }))
      setRecentSessions(sRecentData)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [propertyId])

  useEffect(() => {
    let cancelled = false
    async function pollLive() {
      try {
        const res = await fetch(`/api/v1/analytics/live?propertyId=${encodeURIComponent(propertyId)}`)
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled) setLiveEvents(body.events ?? [])
      } catch {
        // ignore
      }
    }
    pollLive()
    intervalRef.current = setInterval(pollLive, 10_000)
    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [propertyId])

  const sessionCount = sessions7d.length
  const uniqueUsers = new Set(sessions7d.map(s => s.distinctId)).size
  const eventCount = events7d.length
  const conversions = events7d.filter(e => e.event === 'conversion').length

  return (
    <div className="space-y-4">
      <div className="pib-card p-4">
        <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-3">Last 7 days</p>
        {loading ? <Skeleton className="h-16 rounded-md" /> : (
          <div className="grid grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Sessions</p>
              <p className="text-[var(--color-pib-text)] font-medium text-lg">{sessionCount}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Unique users</p>
              <p className="text-[var(--color-pib-text)] font-medium text-lg">{uniqueUsers}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Events</p>
              <p className="text-[var(--color-pib-text)] font-medium text-lg">{eventCount}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-0.5">Conversions</p>
              <p className="text-[var(--color-pib-text)] font-medium text-lg">{conversions}</p>
            </div>
          </div>
        )}
      </div>

      <div className="pib-card overflow-x-auto">
        <div className="p-4 pb-2">
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label">Recent sessions</p>
        </div>
        {loading ? <div className="p-4"><Skeleton className="h-24 rounded-md" /></div> : recentSessions.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-[var(--color-pib-text-muted)]">No sessions yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                {['Time', 'Device', 'Country', 'Referrer', 'Events'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[var(--color-pib-text-muted)] font-label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSessions.map(s => (
                <tr key={s.id} className="border-b border-[var(--color-pib-line)]">
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{formatDateTime(s.startedAt)}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text)]">{s.device ?? ' - '}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{s.country ?? ' - '}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">
                    <span className="truncate inline-block max-w-[20rem]" title={s.referrer ?? ''}>{s.referrer ?? ' - '}</span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-pib-text)]">{s.eventCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="pib-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-xs text-[var(--color-pib-text-muted)] font-label">Live stream</p>
          <span className="flex items-center gap-1.5 text-green-400 text-[11px] font-medium">
            <span className="w-2 h-2 rounded-md bg-green-400 animate-pulse" />
            Live
          </span>
        </div>
        {liveEvents.length === 0 ? (
          <p className="text-xs text-[var(--color-pib-text-muted)]">Waiting for live events…</p>
        ) : (
          <ul className="space-y-1">
            {liveEvents.slice(0, 10).map((ev, i) => {
              const ts = ev.serverTime ?? ev.timestamp
              const ms = tsToMs(ts)
              const time = ms ? new Date(ms).toLocaleTimeString() : 'now'
              const page = ev.pageUrl ?? ' - '
              return (
                <li key={ev.id ?? i} className="text-xs font-mono text-[var(--color-pib-text-muted)]">
                  <span className="text-[var(--color-pib-text-muted)]">[{time}]</span>{' '}
                  <span className="text-[var(--st-warning)]">{ev.event}</span>{' '}
                  <span className="text-[var(--color-pib-text-muted)]">({page})</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="pib-card p-4">
        <p className="text-xs text-[var(--color-pib-text-muted)] font-label mb-3">Quick links</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/portal/analytics/events?propertyId=${encodeURIComponent(propertyId)}`} className="pib-btn-secondary text-xs font-label">Open Events</Link>
          <Link href={`/portal/analytics/sessions?propertyId=${encodeURIComponent(propertyId)}`} className="pib-btn-secondary text-xs font-label">Open Sessions</Link>
          <Link href={`/portal/analytics/live?propertyId=${encodeURIComponent(propertyId)}`} className="pib-btn-secondary text-xs font-label">Open Live</Link>
          <Link href={`/portal/analytics/users?propertyId=${encodeURIComponent(propertyId)}`} className="pib-btn-secondary text-xs font-label">Open Users</Link>
        </div>
      </div>
    </div>
  )
}

// ── Keys Tab ─────────────────────────────────────────────────────────────────

function KeysTab({ property, onRotate }: { property: Property; onRotate: (key: string) => void }) {
  const [rotating, setRotating] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState('')

  async function handleRotate() {
    if (!confirm('Rotating the ingest key will break any clients using the old key. Continue?')) return
    setRotating(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/properties/${property.id}/rotate-ingest-key`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Rotation failed')
      onRotate(body.data.ingestKey)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Rotation failed')
    } finally {
      setRotating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="pib-card p-4 space-y-3">
        <p className="text-xs text-[var(--color-pib-text-muted)] font-label">Ingest Key</p>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          This key is safe to ship in client-side JavaScript. It can only write analytics events
          and fetch this property&apos;s config - it cannot read or modify any other data.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-[var(--color-pib-surface)] px-3 py-2 rounded-lg font-mono break-all text-[var(--color-pib-text)]">
            {showKey ? property.ingestKey : '•'.repeat(32)}
          </code>
          <button
            onClick={() => setShowKey(v => !v)}
            className="pib-btn-secondary text-xs px-3 py-2 shrink-0"
          >
            {showKey ? 'Hide' : 'Reveal'}
          </button>
        </div>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          Key rotated: {formatTs(property.ingestKeyRotatedAt)}
        </p>
        {error && <p className="text-xs text-[var(--st-danger)]">{error}</p>}
        <button
          onClick={handleRotate}
          disabled={rotating}
          className="pib-btn-secondary text-xs font-label text-[var(--color-error,#ef4444)]"
        >
          {rotating ? 'Rotating…' : 'Rotate Key'}
        </button>
      </div>
      <div className="pib-card p-4 text-sm space-y-2">
        <p className="text-xs font-label text-[var(--color-pib-text-muted)]">Usage</p>
        <pre className="text-xs bg-[var(--color-pib-surface)] p-3 rounded-lg overflow-x-auto">
{`// In your micro-site .env
NEXT_PUBLIC_PIB_INGEST_KEY="${property.ingestKey}"
NEXT_PUBLIC_PIB_PROPERTY_ID="${property.id}"

// lib/property-config.ts
const res = await fetch(\`\${PIB_BASE}/properties/\${propertyId}/config\`, {
  headers: { 'x-pib-ingest-key': process.env.NEXT_PUBLIC_PIB_INGEST_KEY! },
  next: { revalidate: 60 },
})
const config = await res.json()`}
        </pre>
      </div>
    </div>
  )
}

// ── Config Tab ────────────────────────────────────────────────────────────

function ConfigTab({ property, onSave }: { property: Property; onSave: (updated: Property) => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (successTimerRef.current) clearTimeout(successTimerRef.current) }, [])

  const [appStoreUrl, setAppStoreUrl] = useState(property.config?.appStoreUrl ?? '')
  const [playStoreUrl, setPlayStoreUrl] = useState(property.config?.playStoreUrl ?? '')
  const [primaryCtaUrl, setPrimaryCtaUrl] = useState(property.config?.primaryCtaUrl ?? '')
  const [siteUrl, setSiteUrl] = useState(property.config?.siteUrl ?? '')
  const [killSwitch, setKillSwitch] = useState(property.config?.killSwitch ?? false)
  const [status, setStatus] = useState(property.status)

  const [featureFlagsText, setFeatureFlagsText] = useState(
    JSON.stringify(property.config?.featureFlags ?? {}, null, 2)
  )
  const [customConfigText, setCustomConfigText] = useState(
    JSON.stringify(property.config?.customConfig ?? {}, null, 2)
  )
  const [conversionSequenceId, setConversionSequenceId] = useState(property.conversionSequenceId ?? '')
  const [creatorLinkPrefix, setCreatorLinkPrefix] = useState(property.creatorLinkPrefix ?? '')

  async function handleSave() {
    setSaving(true); setError(''); setSuccess(false)
    let featureFlags: Record<string, boolean | string> = {}
    let customConfig: Record<string, unknown> = {}
    try {
      featureFlags = JSON.parse(featureFlagsText || '{}')
      customConfig = JSON.parse(customConfigText || '{}')
    } catch {
      setError('Feature flags and custom config must be valid JSON.'); setSaving(false); return
    }

    const body = {
      status,
      config: { appStoreUrl, playStoreUrl, primaryCtaUrl, siteUrl, killSwitch, featureFlags, customConfig },
      conversionSequenceId: conversionSequenceId || null,
      creatorLinkPrefix: creatorLinkPrefix || null,
    }

    try {
      const res = await fetch(`/api/v1/properties/${property.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      onSave(data.data)
      setSuccess(true)
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => setSuccess(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="pib-card p-4 space-y-4">
        <h2 className="text-sm font-label font-medium text-[var(--color-pib-text)]">Status</h2>
        <select aria-label="Property status" value={status} onChange={e => setStatus(e.target.value as PropertyStatus)} className="pib-input text-sm w-48">
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div className="pib-card p-4 space-y-4">
        <h2 className="text-sm font-label font-medium text-[var(--color-pib-text)]">Store &amp; CTA URLs</h2>
        <div>
          <label htmlFor="prop-app-store" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">App Store URL</label>
          <input id="prop-app-store" type="url" value={appStoreUrl} onChange={e => setAppStoreUrl(e.target.value)} placeholder="https://apps.apple.com/…" className="pib-input text-sm w-full" />
        </div>
        <div>
          <label htmlFor="prop-play-store" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">Play Store URL</label>
          <input id="prop-play-store" type="url" value={playStoreUrl} onChange={e => setPlayStoreUrl(e.target.value)} placeholder="https://play.google.com/…" className="pib-input text-sm w-full" />
        </div>
        <div>
          <label htmlFor="prop-cta-url" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">Primary CTA URL (fallback)</label>
          <input id="prop-cta-url" type="url" value={primaryCtaUrl} onChange={e => setPrimaryCtaUrl(e.target.value)} placeholder="https://…" className="pib-input text-sm w-full" />
        </div>
        <div>
          <label htmlFor="prop-site-url" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">Canonical Site URL</label>
          <input id="prop-site-url" type="url" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="https://scrolledbrain.com" className="pib-input text-sm w-full" />
        </div>
      </div>

      <div className="pib-card p-4 space-y-3">
        <h2 className="text-sm font-label font-medium text-[var(--color-pib-text)]">Kill Switch</h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={killSwitch}
            onChange={e => setKillSwitch(e.target.checked)}
            className="w-4 h-4 rounded accent-[var(--color-accent-text)]"
          />
          <span className="text-sm text-[var(--color-pib-text)]">
            Take site offline immediately (returns 503, CDN bypassed)
          </span>
        </label>
      </div>

      <div className="pib-card p-4 space-y-4">
        <h2 className="text-sm font-label font-medium text-[var(--color-pib-text)]">Feature Flags</h2>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          JSON object of key → boolean or string. Example: <code>{`{"cardStyle":"meme","showLeaderboard":true}`}</code>
        </p>
        <textarea
          value={featureFlagsText}
          onChange={e => setFeatureFlagsText(e.target.value)}
          rows={6}
          aria-label="Feature flags JSON"
          className="pib-input text-xs font-mono w-full"
          spellCheck={false}
        />
      </div>

      <div className="pib-card p-4 space-y-4">
        <h2 className="text-sm font-label font-medium text-[var(--color-pib-text)]">Custom Config</h2>
        <p className="text-xs text-[var(--color-pib-text-muted)]">Escape hatch for site-specific config. Any valid JSON object.</p>
        <textarea
          value={customConfigText}
          onChange={e => setCustomConfigText(e.target.value)}
          rows={6}
          aria-label="Custom config JSON"
          className="pib-input text-xs font-mono w-full"
          spellCheck={false}
        />
      </div>

      <div className="pib-card p-4 space-y-4">
        <h2 className="text-sm font-label font-medium text-[var(--color-pib-text)]">Integrations</h2>
        <div>
          <label htmlFor="prop-conv-seq" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">Conversion Sequence ID</label>
          <input
            id="prop-conv-seq"
            type="text"
            value={conversionSequenceId}
            onChange={e => setConversionSequenceId(e.target.value)}
            placeholder="seq_…"
            className="pib-input text-sm w-72"
          />
        </div>
        <div>
          <label htmlFor="prop-creator-prefix" className="text-xs text-[var(--color-pib-text-muted)] font-label block mb-1">Creator Link Prefix</label>
          <input
            id="prop-creator-prefix"
            type="text"
            value={creatorLinkPrefix}
            onChange={e => setCreatorLinkPrefix(e.target.value)}
            placeholder="sb-"
            className="pib-input text-sm w-48"
          />
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
            Links with slugs starting with this prefix are attributed to this property.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--st-danger)] font-label">{error}</p>}
      {success && <p className="text-sm text-green-400 font-label">Saved.</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="pib-btn-primary text-sm font-label"
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )
}

// ── Placeholder tabs ──────────────────────────────────────────────────────

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="pib-card p-5 text-center text-[var(--color-pib-text-muted)] text-sm">
      {label} - coming soon.
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

interface PropertyDetailWorkspaceProps {
  backHref?: string
}

export function PropertyDetailWorkspace({ backHref = '/portal/properties' }: PropertyDetailWorkspaceProps) {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  useEffect(() => {
    fetch(`/api/v1/properties/${id}`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json() })
      .then(body => { setProperty(body.data); setLoading(false) })
      .catch(() => { setLoading(false); router.push(backHref) })
  }, [id, router, backHref])

  if (loading) return (
    <div className="max-w-4xl mx-auto space-y-3" data-module-accent="cyan">
      <Skeleton className="h-8 w-48 rounded-md" />
      <Skeleton className="h-9 rounded-md" />
      <Skeleton className="h-36 rounded-md" />
    </div>
  )

  if (!property) return null

  return (
    <div className="max-w-4xl mx-auto space-y-4" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow={
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1"
          >
            ← Properties
          </button>
        }
        title={property.name}
        description={property.domain}
        meta={<span className="font-mono text-[10px] uppercase tracking-wider">{property.type}</span>}
      />

      <PageTabs
        ariaLabel="Property detail tabs"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as Tab)}
        tabs={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
      />

      {/* Tab content */}
      {activeTab === 'overview'  && <OverviewTab property={property} />}
      {activeTab === 'config' && (
        <ConfigTab
          property={property}
          onSave={(updated) => setProperty(updated)}
        />
      )}
      {activeTab === 'sequences' && <SequencesTab property={property} onUpdate={setProperty} />}
      {activeTab === 'creators'  && <CreatorsTab property={property} />}
      {activeTab === 'analytics' && <PropertyAnalyticsTab property={property} />}
      {activeTab === 'keys'      && (
        <KeysTab
          property={property}
          onRotate={(key) => setProperty(p => p ? { ...p, ingestKey: key } : p)}
        />
      )}
    </div>
  )
}
