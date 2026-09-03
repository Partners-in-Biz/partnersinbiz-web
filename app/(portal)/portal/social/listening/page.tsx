'use client'

import { Icon } from '@/components/studio'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'

interface MonitoredTerm {
  id: string
  term: string
  platforms: string[]
  active: boolean
  matchCount: number
  createdAt?: unknown
  lastCheckedAt?: unknown
}

interface Mention {
  id: string
  platform: string
  type: string
  fromUser: { name?: string; username?: string; avatarUrl?: string; profileUrl?: string } | string
  content: string
  platformUrl: string
  sentiment: string | null
  createdAt: unknown
  matchedTerms: string[]
}

const PLATFORM_OPTIONS = ['twitter', 'linkedin', 'facebook', 'instagram', 'threads', 'reddit']

const PLATFORM_COLORS: Record<string, string> = {
  twitter: 'bg-black',
  x: 'bg-black',
  linkedin: 'bg-blue-700',
  facebook: 'bg-blue-600',
  instagram: 'bg-pink-600',
  threads: 'bg-gray-700',
  reddit: 'bg-orange-600',
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  const t = ts as { _seconds?: number; seconds?: number }
  if (t._seconds) return new Date(t._seconds * 1000)
  if (t.seconds) return new Date(t.seconds * 1000)
  if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts)
  return null
}

function timeAgo(ts: unknown): string {
  const date = tsToDate(ts)
  if (!date) return ' - '
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString()
}

function fromUserName(fromUser: Mention['fromUser']): string {
  if (typeof fromUser === 'string') return fromUser
  if (fromUser && typeof fromUser === 'object') return fromUser.name || fromUser.username || 'Unknown'
  return 'Unknown'
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform.toLowerCase()] || 'bg-[var(--color-pib-line-strong)]'
  return <div className={`w-3 h-3 rounded ${color}`} title={platform} />
}

function SentimentDot({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return <div className="pib-status-dot" />
  const colors: Record<string, string> = {
    positive: 'pib-status-dot-success',
    neutral: '',
    negative: 'pib-status-dot-danger',
  }
  return <div className={`pib-status-dot ${colors[sentiment] ?? ''}`} title={sentiment} />
}

// Unwrap the apiSuccess envelope: { success, data }
async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json()
  return (body?.data ?? body) as T
}

export default function ListeningPage() {
  const [terms, setTerms] = useState<MonitoredTerm[]>([])
  const [mentions, setMentions] = useState<Mention[]>([])
  const [loadingTerms, setLoadingTerms] = useState(true)
  const [loadingMentions, setLoadingMentions] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Add-term form state
  const [newTerm, setNewTerm] = useState('')
  const [newPlatforms, setNewPlatforms] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  // Mention filters
  const [filterTerm, setFilterTerm] = useState<string | null>(null)
  const [filterPlatform, setFilterPlatform] = useState<string | null>(null)

  const fetchTerms = useCallback(async () => {
    setLoadingTerms(true)
    try {
      const res = await fetch('/api/v1/social/listening')
      const data = await unwrap<MonitoredTerm[]>(res)
      setTerms(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching terms:', error)
      setTerms([])
    } finally {
      setLoadingTerms(false)
    }
  }, [])

  const fetchMentions = useCallback(async () => {
    setLoadingMentions(true)
    try {
      const params = new URLSearchParams()
      params.append('limit', '200')
      if (filterTerm) params.append('term', filterTerm)
      if (filterPlatform) params.append('platform', filterPlatform)
      const res = await fetch(`/api/v1/social/listening/mentions?${params.toString()}`)
      const data = await unwrap<{ mentions: Mention[] }>(res)
      setMentions(Array.isArray(data?.mentions) ? data.mentions : [])
    } catch (error) {
      console.error('Error fetching mentions:', error)
      setMentions([])
    } finally {
      setLoadingMentions(false)
    }
  }, [filterTerm, filterPlatform])

  useEffect(() => {
    fetchTerms()
  }, [fetchTerms])

  useEffect(() => {
    fetchMentions()
  }, [fetchMentions])

  const handleAddTerm = async () => {
    const term = newTerm.trim()
    if (!term) return
    setAdding(true)
    setAddError('')
    try {
      const res = await fetch('/api/v1/social/listening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term, platforms: newPlatforms }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setAddError(body?.error || 'Failed to add term')
        return
      }
      setNewTerm('')
      setNewPlatforms([])
      await fetchTerms()
      await fetchMentions()
    } catch (error) {
      console.error('Error adding term:', error)
      setAddError('Failed to add term')
    } finally {
      setAdding(false)
    }
  }

  const handleToggleActive = async (term: MonitoredTerm) => {
    try {
      await fetch(`/api/v1/social/listening/${term.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !term.active }),
      })
      await fetchTerms()
      await fetchMentions()
    } catch (error) {
      console.error('Error toggling term:', error)
    }
  }

  const handleDeleteTerm = async (id: string) => {
    try {
      await fetch(`/api/v1/social/listening/${id}`, { method: 'DELETE' })
      await fetchTerms()
      await fetchMentions()
    } catch (error) {
      console.error('Error deleting term:', error)
    }
  }

  const handleExportCsv = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      params.append('format', 'csv')
      params.append('limit', '500')
      if (filterTerm) params.append('term', filterTerm)
      if (filterPlatform) params.append('platform', filterPlatform)
      const res = await fetch(`/api/v1/social/listening/mentions?${params.toString()}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'social-mentions.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error exporting CSV:', error)
    } finally {
      setExporting(false)
    }
  }

  const togglePlatformInForm = (platform: string) => {
    setNewPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    )
  }

  const activeTermCount = terms.filter((t) => t.active).length
  const totalMatches = terms.reduce((sum, t) => sum + (t.matchCount || 0), 0)
  const mentionPlatforms = Array.from(new Set(mentions.map((m) => m.platform).filter(Boolean)))

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <header>
          <p className="sc-tiny">Social · Listening</p>
          <h1 className="pib-page-title mt-2">Social Listening</h1>
          <p className="pib-page-sub">
            Track keywords and monitor brand mentions across your social platforms
          </p>
        </header>
        <button
          onClick={handleExportCsv}
          disabled={exporting || mentions.length === 0}
          className="btn-pib-secondary shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? 'Exporting…' : '↓ Export CSV'}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="pib-stat-card">
          <p className="pib-label mb-1">Monitored Terms</p>
          <p className="text-2xl text-[var(--color-pib-text)]">{terms.length}</p>
        </div>
        <div className="pib-stat-card">
          <p className="pib-label mb-1">Active</p>
          <p className="text-2xl text-[var(--color-pib-text)]">{activeTermCount}</p>
        </div>
        <div className="pib-stat-card">
          <p className="pib-label mb-1">Total Matches</p>
          <p className="text-2xl text-[var(--color-pib-text)]">{totalMatches}</p>
        </div>
      </div>

      {/* Add Term */}
      <div className="pib-card space-y-4">
        <p className="pib-label">Add a monitored term</p>
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTerm()
            }}
            placeholder="e.g. your brand name, a product, a competitor…"
            aria-label="Monitored term"
            className="pib-input w-full"
           aria-label="e.g. your brand name, a product, a competitor…"/>
          <div>
            <p className="text-xs text-[var(--color-pib-text-muted)] mb-2">Platforms (leave empty to watch all)</p>
            <div className="flex gap-2 flex-wrap">
              {PLATFORM_OPTIONS.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatformInForm(platform)}
                  className={`px-3 py-1.5 rounded text-sm font-label flex items-center gap-2 transition-colors ${
                    newPlatforms.includes(platform)
                      ? 'bg-[var(--color-accent-v2)] text-black'
                      : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                  }`}
                >
                  <PlatformBadge platform={platform} />
                  {platform}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleAddTerm}
              disabled={adding || !newTerm.trim()}
              className="btn-pib-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adding ? 'Adding…' : 'Add term'}
            </button>
            {addError && <span className="text-sm text-[var(--color-error)]">{addError}</span>}
          </div>
        </div>
      </div>

      {/* Monitored Terms List */}
      <div className="space-y-2">
        <p className="pib-label">Monitored Terms</p>
        {loadingTerms ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="pib-skeleton h-14" />
            ))}
          </div>
        ) : terms.length === 0 ? (
          <div className="pib-empty-state">
            <Icon name="hearing" />
            <h2 className="pib-empty-state-title">No monitored terms yet</h2>
            <p className="pib-empty-state-description">Add one above to start listening.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {terms.map((term) => (
              <div
                key={term.id}
                className="pib-card hover:bg-[var(--color-row-hover)] transition-colors flex items-center justify-between gap-4"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="shrink-0">
                    <Icon name="hearing" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-medium text-[var(--color-pib-text)] truncate">{term.term}</p>
                      <span className="pib-pill pib-pill-rose">
                        {term.matchCount || 0} matches
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {term.platforms && term.platforms.length > 0 ? (
                        term.platforms.map((p) => (
                          <span
                            key={p}
                            className="pib-pill flex items-center gap-1"
                          >
                            <PlatformBadge platform={p} />
                            {p}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-[var(--color-pib-text-muted)]">All platforms</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleActive(term)}
                    className={`pib-pill transition-colors ${
                      term.active ? 'pib-pill-success' : ''
                    }`}
                  >
                    {term.active ? 'Active' : 'Paused'}
                  </button>
                  <button
                    onClick={() => handleDeleteTerm(term.id)}
                    className="btn-pib-ghost text-xs hover:text-[var(--color-error)]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mentions Feed */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="pib-label">Mentions Feed</p>
        </div>

        {/* Filters */}
        <div className="pib-card space-y-4">
          <div>
            <p className="text-xs text-[var(--color-pib-text-muted)] mb-2">Term</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilterTerm(null)}
                className={`px-3 py-1.5 rounded text-sm font-label transition-colors ${
                  filterTerm === null
                    ? 'bg-[var(--color-accent-v2)] text-black'
                    : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                }`}
              >
                All
              </button>
              {terms.map((term) => (
                <button
                  key={term.id}
                  onClick={() => setFilterTerm(term.term)}
                  className={`px-3 py-1.5 rounded text-sm font-label transition-colors ${
                    filterTerm === term.term
                      ? 'bg-[var(--color-accent-v2)] text-black'
                      : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                  }`}
                >
                  {term.term}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-[var(--color-pib-text-muted)] mb-2">Platform</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilterPlatform(null)}
                className={`px-3 py-1.5 rounded text-sm font-label transition-colors ${
                  filterPlatform === null
                    ? 'bg-[var(--color-accent-v2)] text-black'
                    : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                }`}
              >
                All
              </button>
              {mentionPlatforms.map((platform) => (
                <button
                  key={platform}
                  onClick={() => setFilterPlatform(platform)}
                  className={`px-3 py-1.5 rounded text-sm font-label flex items-center gap-2 transition-colors ${
                    filterPlatform === platform
                      ? 'bg-[var(--color-accent-v2)] text-black'
                      : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                  }`}
                >
                  <PlatformBadge platform={platform} />
                  {platform}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Feed list */}
        {loadingMentions ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="pib-skeleton h-20" />
            ))}
          </div>
        ) : mentions.length === 0 ? (
          <div className="pib-empty-state">
            <Icon name="notifications" />
            <h2 className="pib-empty-state-title">No mentions found</h2>
            <p className="pib-empty-state-description">
              Add monitored terms and refresh your inbox to surface matches.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {mentions.map((mention) => (
              <div
                key={mention.id}
                className="pib-card hover:bg-[var(--color-row-hover)] transition-colors"
              >
                <div className="flex items-start gap-4">
                  <PlatformBadge platform={mention.platform} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-medium text-[var(--color-pib-text)]">{fromUserName(mention.fromUser)}</p>
                      <span className="pib-pill">
                        {mention.type || 'mention'}
                      </span>
                      <SentimentDot sentiment={mention.sentiment} />
                    </div>
                    <p className="text-sm text-[var(--color-pib-text)] break-words">{mention.content}</p>
                    {mention.matchedTerms.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        {mention.matchedTerms.map((t) => (
                          <span
                            key={t}
                            className="pib-pill pib-pill-rose"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {mention.platformUrl && (
                      <a
                        href={mention.platformUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-pib-ghost mt-2 inline-flex text-xs"
                      >
                        View on {mention.platform}
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-pib-text-muted)] shrink-0">{timeAgo(mention.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
