'use client'
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
    : '—'
}

function PlatformBadge({ platform }: { platform: string }) {
  const cfg = PLATFORM_COLORS[platform.toLowerCase()]
  if (!cfg) return <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-surface-container-high text-on-surface-variant uppercase">{platform}</span>
  return <span className={`${cfg.bg} text-white text-[10px] px-2 py-0.5 rounded font-bold`}>{cfg.label}</span>
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-green-900/30 text-green-400',
    paused: 'bg-yellow-900/30 text-yellow-400',
    error: 'bg-red-900/30 text-red-400',
  }
  return <span className={`text-[10px] px-2 py-0.5 rounded font-medium capitalize ${styles[status] ?? 'bg-surface-container-high text-on-surface-variant'}`}>{status}</span>
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">RSS Feeds</h1>
          <p className="text-sm text-on-surface-variant mt-1">Auto-create social posts from RSS feeds</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 rounded-lg bg-white text-black font-label text-sm font-medium hover:bg-white/90 transition-colors"
        >
          {showCreate ? 'Cancel' : 'Add Feed'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl bg-surface-container p-5 space-y-4">
          <h2 className="text-sm font-semibold text-on-surface">New RSS Feed</h2>

          {formError && (
            <div className="px-4 py-2 rounded-lg bg-red-900/30 text-red-400 text-xs">{formError}</div>
          )}

          <div>
            <label className="block text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Blog RSS"
              className="w-full rounded-xl bg-surface px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-transparent focus:border-outline-variant transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Feed URL</label>
            <input
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              className="w-full rounded-xl bg-surface px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-transparent focus:border-outline-variant transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Target Platforms</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(p.id)}
                  className={`px-3 py-1.5 rounded-lg font-label text-xs font-medium transition-colors ${
                    targetPlatforms.includes(p.id)
                      ? 'bg-white text-black'
                      : 'bg-surface text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Post Template</label>
            <textarea
              rows={2}
              value={postTemplate}
              onChange={(e) => setPostTemplate(e.target.value)}
              placeholder="{{title}} {{url}}"
              className="w-full rounded-xl bg-surface px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-transparent focus:border-outline-variant transition-colors resize-none"
            />
            <p className="text-[10px] text-on-surface-variant mt-1">
              Variables: {'{{title}}'}, {'{{url}}'}, {'{{description}}'}, {'{{author}}'}, {'{{category}}'}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={autoSchedule}
                onChange={(e) => setAutoSchedule(e.target.checked)}
                className="accent-white"
              />
              Auto-schedule posts
            </label>

            <div className="flex items-center gap-2">
              <label className="text-xs text-on-surface-variant">Check every</label>
              <select
                value={checkInterval}
                onChange={(e) => setCheckInterval(Number(e.target.value))}
                className="rounded-lg bg-surface px-2 py-1 text-xs text-on-surface outline-none"
              >
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
            className="px-4 py-2 rounded-lg bg-white text-black font-label text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Feed'}
          </button>
        </div>
      )}

      {/* Feeds list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <div className="py-16 text-center text-on-surface-variant text-sm">
          No RSS feeds configured yet. Add one to auto-create social posts from your content.
        </div>
      ) : (
        <div className="space-y-3">
          {feeds.map((feed) => (
            <div key={feed.id} className="rounded-xl bg-surface-container p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-on-surface">{feed.name}</h3>
                    <StatusBadge status={feed.status} />
                  </div>
                  <p className="text-xs text-on-surface-variant truncate mt-0.5">{feed.feedUrl}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {feed.targetPlatforms?.map((p) => (
                    <PlatformBadge key={p} platform={p} />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-on-surface-variant">
                <span>{feed.itemsPublished ?? 0} posts created</span>
                <span>Every {feed.checkIntervalMinutes}m</span>
                <span>Last checked: {fmtDateTime(feed.lastCheckedAt)}</span>
                {feed.autoSchedule && <span className="text-green-400">Auto-schedule</span>}
              </div>

              {feed.lastError && (
                <p className="text-xs text-red-400">Error: {feed.lastError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleAction(feed.id, 'check')}
                  disabled={actionLoading === feed.id}
                  className="px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface font-label text-xs font-medium hover:bg-surface-container transition-colors disabled:opacity-50"
                >
                  Check Now
                </button>
                {feed.status === 'active' ? (
                  <button
                    onClick={() => handleAction(feed.id, 'pause')}
                    disabled={actionLoading === feed.id}
                    className="px-3 py-1.5 rounded-lg bg-yellow-900/20 text-yellow-400 font-label text-xs font-medium hover:bg-yellow-900/30 transition-colors disabled:opacity-50"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={() => handleAction(feed.id, 'resume')}
                    disabled={actionLoading === feed.id}
                    className="px-3 py-1.5 rounded-lg bg-green-900/20 text-green-400 font-label text-xs font-medium hover:bg-green-900/30 transition-colors disabled:opacity-50"
                  >
                    Resume
                  </button>
                )}
                <button
                  onClick={() => handleDelete(feed.id)}
                  disabled={actionLoading === feed.id}
                  className="px-3 py-1.5 rounded-lg bg-red-900/20 text-red-400 font-label text-xs font-medium hover:bg-red-900/30 transition-colors disabled:opacity-50"
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
