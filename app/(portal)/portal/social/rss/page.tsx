'use client'

import { Icon } from '@/components/studio'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useOrg } from '@/lib/contexts/OrgContext'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RssFeed {
  id: string
  name: string
  feedUrl: string
  status: 'active' | 'paused' | 'error'
  targetPlatforms: string[]
  postTemplate: string
  includeImage: boolean
  autoSchedule: boolean
  schedulingStrategy: string
  checkIntervalMinutes: number
  itemsPublished: number
  consecutiveErrors: number
  lastError: string | null
  lastCheckedAt: any
  createdAt: any
}

const PLATFORM_COLORS: Record<string, { bg: string; label: string }> = {
  twitter: { bg: 'bg-black', label: 'X' },
  x: { bg: 'bg-black', label: 'X' },
  linkedin: { bg: 'bg-blue-700', label: 'LI' },
  facebook: { bg: 'bg-blue-600', label: 'FB' },
  instagram: { bg: 'bg-pink-600', label: 'IG' },
  reddit: { bg: 'bg-orange-600', label: 'RD' },
  tiktok: { bg: 'bg-gray-800', label: 'TT' },
  pinterest: { bg: 'bg-red-700', label: 'PI' },
  bluesky: { bg: 'bg-sky-500', label: 'BS' },
  threads: { bg: 'bg-gray-700', label: 'TH' },
}

const PLATFORMS = [
  { id: 'twitter', label: 'X (Twitter)' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'pinterest', label: 'Pinterest' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'threads', label: 'Threads' },
]

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function tsToDate(ts: any): Date | null {
  if (!ts) return null
  if (ts._seconds) return new Date(ts._seconds * 1000)
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

function fmtDateTime(ts: any) {
  const d = tsToDate(ts)
  return d
    ? d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : ' - '
}

function PlatformBadge({ platform }: { platform: string }) {
  const cfg = PLATFORM_COLORS[platform.toLowerCase()]
  if (!cfg) return <span className="pib-pill uppercase">{platform}</span>
  return <span className={`${cfg.bg} text-white text-[10px] px-2 py-0.5 rounded `}>{cfg.label}</span>
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'pib-pill-success',
    paused: 'pib-pill-warn',
    error: 'pib-pill-danger',
  }
  return <span className={`pib-pill capitalize ${styles[status] ?? ''}`}>{status}</span>
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function RssPage() {
  const { orgId } = useOrg()
  const [feeds, setFeeds] = useState<RssFeed[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [targetPlatforms, setTargetPlatforms] = useState<string[]>(['twitter'])
  const [postTemplate, setPostTemplate] = useState('{{title}} {{url}}')
  const [autoSchedule, setAutoSchedule] = useState(false)
  const [checkInterval, setCheckInterval] = useState(60)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchFeeds = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/social/rss/feeds${orgId ? `?orgId=${orgId}` : ''}`)
      const body = await res.json()
      setFeeds(body.data ?? [])
    } catch {
      setFeeds([])
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { fetchFeeds() }, [fetchFeeds])

  const togglePlatform = (id: string) => {
    setTargetPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  const handleCreate = async () => {
    setFormError('')
    if (!name.trim()) { setFormError('Name is required'); return }
    if (!feedUrl.trim()) { setFormError('Feed URL is required'); return }
    if (targetPlatforms.length === 0) { setFormError('Select at least one platform'); return }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/v1/social/rss/feeds${orgId ? `?orgId=${orgId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          feedUrl: feedUrl.trim(),
          targetPlatforms,
          postTemplate: postTemplate.trim() || '{{title}} {{url}}',
          autoSchedule,
          checkIntervalMinutes: checkInterval,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to create feed')
      setShowCreate(false)
      setName('')
      setFeedUrl('')
      setPostTemplate('{{title}} {{url}}')
      setAutoSchedule(false)
      setCheckInterval(60)
      fetchFeeds()
    } catch (err: any) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleAction = async (feedId: string, action: string) => {
    setActionLoading(feedId)
    try {
      await fetch(`/api/v1/social/rss/feeds/${feedId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      fetchFeeds()
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (feedId: string) => {
    if (!confirm('Delete this RSS feed?')) return
    setActionLoading(feedId)
    try {
      await fetch(`/api/v1/social/rss/feeds/${feedId}`, { method: 'DELETE' })
      fetchFeeds()
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <header>
          <p className="sc-tiny">Social · RSS</p>
          <h1 className="pib-page-title mt-2">RSS Feeds</h1>
          <p className="pib-page-sub">Auto-create social posts from RSS feeds</p>
        </header>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-pib-primary shrink-0"
        >
          {showCreate ? 'Cancel' : 'Add Feed'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="pib-card space-y-4">
          <h2 className="pib-label">New RSS Feed</h2>

          {formError && (
            <div className="rounded-lg border border-[var(--color-error)]/40 px-4 py-2 text-xs text-[var(--color-error)]">{formError}</div>
          )}

          <div>
            <label className="pib-label block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Blog RSS"
              className="pib-input w-full"
             aria-label="My Blog RSS"/>
          </div>

          <div>
            <label className="pib-label block mb-1">Feed URL</label>
            <input
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              className="pib-input w-full"
             aria-label="https://example.com/feed.xml"/>
          </div>

          <div>
            <label className="pib-label block mb-1">Target Platforms</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(p.id)}
                  className={`px-3 py-1.5 rounded font-label text-xs font-medium transition-colors ${
                    targetPlatforms.includes(p.id)
                      ? 'bg-[var(--color-pib-text)] text-[var(--color-pib-bg)]'
                      : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="pib-label block mb-1">Post Template</label>
            <textarea
              rows={2}
              value={postTemplate}
              onChange={(e) => setPostTemplate(e.target.value)}
              placeholder="{{title}} {{url}}"
              className="pib-textarea w-full resize-none"
             aria-label="{{title}} {{url}}"/>
            <p className="text-[10px] text-[var(--color-pib-text-muted)] mt-1">
              Variables: {'{{title}}'}, {'{{url}}'}, {'{{description}}'}, {'{{author}}'}, {'{{category}}'}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={autoSchedule}
                onChange={(e) => setAutoSchedule(e.target.checked)}
                className="accent-[var(--color-accent-v2)]"
               aria-label="Toggle"/>
              Auto-schedule posts
            </label>

            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--color-pib-text-muted)]">Check every</label>
              <select
                value={checkInterval}
                onChange={(e) => setCheckInterval(Number(e.target.value))}
                className="pib-select text-xs"
               aria-label="Input">
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={360}>6 hours</option>
                <option value={1440}>24 hours</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={submitting}
            className="btn-pib-primary disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Feed'}
          </button>
        </div>
      )}

      {/* Feeds list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="pib-skeleton h-16" />
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="rss_feed" />
          <h2 className="pib-empty-state-title">No RSS feeds configured yet</h2>
          <p className="pib-empty-state-description">Add one to auto-create social posts from your content.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {feeds.map((feed) => (
            <div key={feed.id} className="pib-card space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="shrink-0">
                    <Icon name="rss_feed" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm text-[var(--color-pib-text)]">{feed.name}</h3>
                      <StatusBadge status={feed.status} />
                    </div>
                    <p className="text-xs text-[var(--color-pib-text-muted)] truncate mt-0.5">{feed.feedUrl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {feed.targetPlatforms?.map((p) => (
                    <PlatformBadge key={p} platform={p} />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-[var(--color-pib-text-muted)]">
                <span>{feed.itemsPublished ?? 0} posts created</span>
                <span>Every {feed.checkIntervalMinutes}m</span>
                <span>Last checked: {fmtDateTime(feed.lastCheckedAt)}</span>
                {feed.autoSchedule && <span className="text-[var(--color-pib-success)]">Auto-schedule</span>}
              </div>

              {feed.lastError && (
                <p className="text-xs text-[var(--color-error)]">Error: {feed.lastError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleAction(feed.id, 'check')}
                  disabled={actionLoading === feed.id}
                  className="btn-pib-secondary text-xs disabled:opacity-50"
                >
                  Check Now
                </button>
                {feed.status === 'active' ? (
                  <button
                    onClick={() => handleAction(feed.id, 'pause')}
                    disabled={actionLoading === feed.id}
                    className="btn-pib-ghost text-xs disabled:opacity-50"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={() => handleAction(feed.id, 'resume')}
                    disabled={actionLoading === feed.id}
                    className="btn-pib-ghost text-xs text-[var(--color-pib-success)] disabled:opacity-50"
                  >
                    Resume
                  </button>
                )}
                <button
                  onClick={() => handleDelete(feed.id)}
                  disabled={actionLoading === feed.id}
                  className="btn-pib-ghost text-xs text-[var(--color-error)] disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
