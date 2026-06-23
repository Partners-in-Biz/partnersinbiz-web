'use client'
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
  if (!date) return '—'
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
  const color = PLATFORM_COLORS[platform.toLowerCase()] || 'bg-surface-container-high'
  return <div className={`w-3 h-3 rounded-full ${color}`} title={platform} />
}

function SentimentDot({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return <div className="w-2 h-2 rounded-full bg-gray-400" />
  const colors: Record<string, string> = {
    positive: 'bg-green-500',
    neutral: 'bg-gray-400',
    negative: 'bg-red-500',
  }
  return <div className={`w-2 h-2 rounded-full ${colors[sentiment] ?? 'bg-gray-400'}`} title={sentiment} />
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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Social Listening</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Track keywords and monitor brand mentions across your social platforms
          </p>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={exporting || mentions.length === 0}
          className="px-4 py-2 rounded-lg bg-[#F59E0B] text-black font-medium text-sm hover:bg-[#F59E0B]/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {exporting ? 'Exporting…' : '↓ Export CSV'}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-lg bg-surface-container">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Monitored Terms</p>
          <p className="text-2xl font-bold text-on-surface">{terms.length}</p>
        </div>
        <div className="p-4 rounded-lg bg-surface-container">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Active</p>
          <p className="text-2xl font-bold text-on-surface">{activeTermCount}</p>
        </div>
        <div className="p-4 rounded-lg bg-surface-container">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Total Matches</p>
          <p className="text-2xl font-bold text-on-surface">{totalMatches}</p>
        </div>
      </div>

      {/* Add Term */}
      <div className="space-y-3 p-4 rounded-lg bg-surface-container">
        <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Add a monitored term</p>
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTerm()
            }}
            placeholder="e.g. your brand name, a product, a competitor…"
            className="w-full bg-surface-container-high text-on-surface placeholder-on-surface-variant rounded p-2.5 text-sm border border-outline-variant focus:outline-none focus:border-[#F59E0B]"
          />
          <div>
            <p className="text-xs text-on-surface-variant mb-2">Platforms (leave empty to watch all)</p>
            <div className="flex gap-2 flex-wrap">
              {PLATFORM_OPTIONS.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatformInForm(platform)}
                  className={`px-3 py-1.5 rounded text-sm font-label flex items-center gap-2 ${
                    newPlatforms.includes(platform)
                      ? 'bg-[#F59E0B] text-black'
                      : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
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
              className="px-4 py-2 rounded-lg bg-[#F59E0B] text-black font-medium text-sm hover:bg-[#F59E0B]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adding ? 'Adding…' : 'Add term'}
            </button>
            {addError && <span className="text-sm text-red-400">{addError}</span>}
          </div>
        </div>
      </div>

      {/* Monitored Terms List */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Monitored Terms</p>
        {loadingTerms ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-surface-container animate-pulse" />
            ))}
          </div>
        ) : terms.length === 0 ? (
          <div className="p-8 rounded-lg bg-surface-container text-center">
            <p className="text-on-surface-variant">No monitored terms yet. Add one above to start listening.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {terms.map((term) => (
              <div
                key={term.id}
                className="p-4 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-medium text-on-surface truncate">{term.term}</p>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-medium">
                      {term.matchCount || 0} matches
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {term.platforms && term.platforms.length > 0 ? (
                      term.platforms.map((p) => (
                        <span
                          key={p}
                          className="text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant flex items-center gap-1"
                        >
                          <PlatformBadge platform={p} />
                          {p}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-on-surface-variant">All platforms</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleActive(term)}
                    className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                      term.active
                        ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                        : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {term.active ? 'Active' : 'Paused'}
                  </button>
                  <button
                    onClick={() => handleDeleteTerm(term.id)}
                    className="text-xs px-3 py-1.5 rounded bg-surface-container-high text-on-surface-variant hover:text-red-400 transition-colors"
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
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Mentions Feed</p>
        </div>

        {/* Filters */}
        <div className="space-y-3 p-4 rounded-lg bg-surface-container">
          <div>
            <p className="text-xs text-on-surface-variant mb-2">Term</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilterTerm(null)}
                className={`px-3 py-1.5 rounded text-sm font-label ${
                  filterTerm === null
                    ? 'bg-[#F59E0B] text-black'
                    : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                }`}
              >
                All
              </button>
              {terms.map((term) => (
                <button
                  key={term.id}
                  onClick={() => setFilterTerm(term.term)}
                  className={`px-3 py-1.5 rounded text-sm font-label ${
                    filterTerm === term.term
                      ? 'bg-[#F59E0B] text-black'
                      : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {term.term}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-on-surface-variant mb-2">Platform</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilterPlatform(null)}
                className={`px-3 py-1.5 rounded text-sm font-label ${
                  filterPlatform === null
                    ? 'bg-[#F59E0B] text-black'
                    : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                }`}
              >
                All
              </button>
              {mentionPlatforms.map((platform) => (
                <button
                  key={platform}
                  onClick={() => setFilterPlatform(platform)}
                  className={`px-3 py-1.5 rounded text-sm font-label flex items-center gap-2 ${
                    filterPlatform === platform
                      ? 'bg-[#F59E0B] text-black'
                      : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
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
              <div key={i} className="h-20 rounded-lg bg-surface-container animate-pulse" />
            ))}
          </div>
        ) : mentions.length === 0 ? (
          <div className="p-8 rounded-lg bg-surface-container text-center">
            <p className="text-on-surface-variant">
              No mentions found. Add monitored terms and refresh your inbox to surface matches.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {mentions.map((mention) => (
              <div
                key={mention.id}
                className="p-4 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors"
              >
                <div className="flex items-start gap-4">
                  <PlatformBadge platform={mention.platform} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-medium text-on-surface">{fromUserName(mention.fromUser)}</p>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-medium">
                        {mention.type || 'mention'}
                      </span>
                      <SentimentDot sentiment={mention.sentiment} />
                    </div>
                    <p className="text-sm text-on-surface break-words">{mention.content}</p>
                    {mention.matchedTerms.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        {mention.matchedTerms.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] px-2 py-0.5 rounded bg-[#F59E0B]/20 text-[#F59E0B] font-medium"
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
                        className="inline-block mt-2 text-xs px-2 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                      >
                        View on {mention.platform}
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-on-surface-variant shrink-0">{timeAgo(mention.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
