'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { copyToClipboard as copyTextToClipboard } from '@/lib/utils/clipboard'

type TimestampLike = { _seconds?: number; seconds?: number } | string | number | Date | null | undefined

interface ShortenedLink {
  id: string
  shortCode: string
  shortUrl: string
  originalUrl: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  clickCount: number
  createdAt: TimestampLike
  createdBy: string
}

interface LinkStats {
  totalClicks: number
  clicksByDay: Array<{ date: string; count: number }>
  topReferrers: Array<{ referrer: string; count: number }>
  topCountries: Array<{ country: string; count: number }>
  recentClicks: Array<{
    timestamp: TimestampLike
    referrer: string | null
    country: string | null
  }>
}

interface SelectedLinkData extends ShortenedLink {
  stats: LinkStats
}

interface SocialLinksWorkspaceProps {
  buildApiPath?: (path: string) => string
}

const LIMIT = 20

function formatCreatedDate(value: TimestampLike): string {
  if (value instanceof Date) return value.toLocaleDateString()
  if (value && typeof value === 'object') {
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toLocaleDateString()
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000).toLocaleDateString()
    return 'Date missing'
  }
  if (typeof value === 'number') return new Date(value).toLocaleDateString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Date missing' : date.toLocaleDateString()
  }
  return 'Date missing'
}

export default function SocialLinksWorkspace({ buildApiPath }: SocialLinksWorkspaceProps) {
  const [links, setLinks] = useState<ShortenedLink[]>([])
  const [selectedLink, setSelectedLink] = useState<SelectedLinkData | null>(null)
  const [pendingDeleteLink, setPendingDeleteLink] = useState<ShortenedLink | null>(null)
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalLinks, setTotalLinks] = useState(0)
  const [originalUrl, setOriginalUrl] = useState('')
  const [utmSource, setUtmSource] = useState('')
  const [utmMedium, setUtmMedium] = useState('')
  const [utmCampaign, setUtmCampaign] = useState('')
  const [utmTerm, setUtmTerm] = useState('')
  const [utmContent, setUtmContent] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const apiPath = useCallback((path: string) => buildApiPath?.(path) ?? path, [buildApiPath])

  const fetchLinks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/v1/links?page=${page}&limit=${LIMIT}`))
      const data = await res.json()
      if (data.success) {
        setLinks(data.data ?? [])
        setTotalLinks(data.meta?.total || 0)
      }
    } catch (err) {
      console.error('Failed to fetch links:', err)
      setLinks([])
      setTotalLinks(0)
    } finally {
      setLoading(false)
    }
  }, [apiPath, page])

  const fetchLinkStats = useCallback(async (linkId: string) => {
    try {
      const res = await fetch(apiPath(`/api/v1/links/${linkId}`))
      const data = await res.json()
      if (data.success) {
        setSelectedLink(data.data)
      }
    } catch (err) {
      console.error('Failed to fetch link stats:', err)
    }
  }, [apiPath])

  useEffect(() => {
    fetchLinks()
  }, [fetchLinks])

  const buildPreviewUrl = (): string => {
    if (!originalUrl) return ''
    try {
      const url = new URL(originalUrl)
      if (utmSource) url.searchParams.set('utm_source', utmSource)
      if (utmMedium) url.searchParams.set('utm_medium', utmMedium)
      if (utmCampaign) url.searchParams.set('utm_campaign', utmCampaign)
      if (utmTerm) url.searchParams.set('utm_term', utmTerm)
      if (utmContent) url.searchParams.set('utm_content', utmContent)
      return url.toString()
    } catch {
      return ''
    }
  }

  const handleCreateLink = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!originalUrl) {
      setError('Original URL is required')
      return
    }

    setCreating(true)
    try {
      const res = await fetch(apiPath('/api/v1/links'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalUrl,
          utmSource: utmSource || undefined,
          utmMedium: utmMedium || undefined,
          utmCampaign: utmCampaign || undefined,
          utmTerm: utmTerm || undefined,
          utmContent: utmContent || undefined,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setSuccess('Link created successfully!')
        setOriginalUrl('')
        setUtmSource('')
        setUtmMedium('')
        setUtmCampaign('')
        setUtmTerm('')
        setUtmContent('')
        setPage(1)
        await fetchLinks()
      } else {
        setError(data.error || 'Failed to create link')
      }
    } catch (err) {
      setError('Failed to create link')
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteLink = async (link: ShortenedLink) => {
    setDeletingLinkId(link.id)
    setError('')
    try {
      const res = await fetch(apiPath(`/api/v1/links/${link.id}`), { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        if (selectedLink?.id === link.id) setSelectedLink(null)
        setLinks(prev => prev.filter(item => item.id !== link.id))
        setTotalLinks(prev => Math.max(0, prev - 1))
        setPendingDeleteLink(null)
      } else {
        setError('Failed to delete link')
      }
    } catch (err) {
      setError('Failed to delete link')
      console.error(err)
    } finally {
      setDeletingLinkId(null)
    }
  }

  const handleCopyLink = async (text: string) => {
    await copyTextToClipboard(text)
    setSuccess('Copied to clipboard!')
    setTimeout(() => setSuccess(''), 2000)
  }

  const previewUrl = buildPreviewUrl()

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="font-headline text-2xl font-bold tracking-tighter text-[var(--color-on-surface)]">Link Shortener</h1>
        <p className="text-sm text-[var(--color-on-surface-variant)] mt-1">
          Create and manage shortened links with UTM tracking.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <section className="pib-card p-6">
            <h2 className="text-xl font-semibold mb-4">Create Shortened Link</h2>

            {error && (
              <div className="mb-4 rounded border border-red-400/50 bg-red-900/30 p-3 text-sm text-red-200">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 rounded border border-green-400/50 bg-green-900/30 p-3 text-sm text-green-200">
                {success}
              </div>
            )}

            <form onSubmit={handleCreateLink} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="tracked-link-original-url">
                  Original URL
                </label>
                <input
                  id="tracked-link-original-url"
                  type="url"
                  value={originalUrl}
                  onChange={e => setOriginalUrl(e.target.value)}
                  placeholder="https://example.com/page"
                  className="pib-input w-full"
                />
              </div>

              <div className="border-t border-[var(--color-outline-variant)] pt-4">
                <h3 className="text-sm font-semibold mb-3 text-[var(--color-accent-v2)]">UTM Parameters (Optional)</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-on-surface-variant)] mb-1" htmlFor="tracked-link-utm-source">
                      Source
                    </label>
                    <input
                      id="tracked-link-utm-source"
                      type="text"
                      value={utmSource}
                      onChange={e => setUtmSource(e.target.value)}
                      placeholder="e.g., twitter"
                      className="pib-input w-full !py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-on-surface-variant)] mb-1" htmlFor="tracked-link-utm-medium">
                      Medium
                    </label>
                    <input
                      id="tracked-link-utm-medium"
                      type="text"
                      value={utmMedium}
                      onChange={e => setUtmMedium(e.target.value)}
                      placeholder="e.g., social"
                      className="pib-input w-full !py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-on-surface-variant)] mb-1" htmlFor="tracked-link-utm-campaign">
                      Campaign
                    </label>
                    <input
                      id="tracked-link-utm-campaign"
                      type="text"
                      value={utmCampaign}
                      onChange={e => setUtmCampaign(e.target.value)}
                      placeholder="e.g., launch"
                      className="pib-input w-full !py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-on-surface-variant)] mb-1" htmlFor="tracked-link-utm-term">
                      Term
                    </label>
                    <input
                      id="tracked-link-utm-term"
                      type="text"
                      value={utmTerm}
                      onChange={e => setUtmTerm(e.target.value)}
                      placeholder="e.g., keyword"
                      className="pib-input w-full !py-1 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[var(--color-on-surface-variant)] mb-1" htmlFor="tracked-link-utm-content">
                      Content
                    </label>
                    <input
                      id="tracked-link-utm-content"
                      type="text"
                      value={utmContent}
                      onChange={e => setUtmContent(e.target.value)}
                      placeholder="e.g., banner"
                      className="pib-input w-full !py-1 text-sm"
                    />
                  </div>
                </div>
              </div>

              {previewUrl && (
                <div className="rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-high)] p-3">
                  <p className="mb-1 text-xs text-[var(--color-on-surface-variant)]">Preview with UTM params:</p>
                  <p className="break-all text-xs text-[var(--color-accent-v2)]">{previewUrl}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={creating || !originalUrl}
                className="pib-btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Shorten Link'}
              </button>
            </form>
          </section>
        </div>

        {selectedLink && (
          <section className="pib-card p-6 h-fit">
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold">Stats</h2>
              <button
                type="button"
                onClick={() => setSelectedLink(null)}
                aria-label={`Close stats for ${selectedLink.shortCode}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-on-surface)]"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="rounded bg-[var(--color-surface-container-high)] p-3">
                <p className="text-[var(--color-on-surface-variant)]">Total Clicks</p>
                <p className="text-2xl font-bold text-[var(--color-accent-v2)]">{selectedLink.stats.totalClicks}</p>
              </div>

              {selectedLink.stats.topReferrers.length > 0 && (
                <div>
                  <p className="mb-2 font-medium text-[var(--color-on-surface-variant)]">Top Referrers</p>
                  <div className="space-y-1">
                    {selectedLink.stats.topReferrers.slice(0, 5).map((ref, i) => (
                      <div key={`${ref.referrer}-${i}`} className="flex justify-between gap-3 text-xs">
                        <span className="truncate text-[var(--color-on-surface)]">{ref.referrer}</span>
                        <span className="text-[var(--color-accent-v2)]">{ref.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedLink.stats.topCountries.length > 0 && (
                <div>
                  <p className="mb-2 font-medium text-[var(--color-on-surface-variant)]">Top Countries</p>
                  <div className="space-y-1">
                    {selectedLink.stats.topCountries.slice(0, 5).map((country, i) => (
                      <div key={`${country.country}-${i}`} className="flex justify-between gap-3 text-xs">
                        <span className="truncate text-[var(--color-on-surface)]">{country.country}</span>
                        <span className="text-[var(--color-accent-v2)]">{country.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      <section className="pib-card overflow-hidden">
        {pendingDeleteLink && (
          <div
            role="alertdialog"
            aria-labelledby="tracked-link-delete-title"
            aria-describedby="tracked-link-delete-description"
            className="m-4 rounded-lg border border-red-400/25 bg-red-500/10 p-4"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <span className="material-symbols-outlined mt-0.5 text-red-200" aria-hidden="true">
                  link_off
                </span>
                <div>
                  <p className="eyebrow !text-[10px] !text-red-100/80">Tracked link delete</p>
                  <h2 id="tracked-link-delete-title" className="mt-1 font-display text-lg text-red-50">
                    Delete tracked link &quot;{pendingDeleteLink.shortCode}&quot;?
                  </h2>
                  <p id="tracked-link-delete-description" className="mt-2 max-w-2xl text-sm text-red-100/90">
                    This removes the short link from future campaign use. Historical click analytics stay available in reports and audits.
                  </p>
                  <p className="mt-2 break-all text-xs text-[var(--color-on-surface-variant)]">
                    {pendingDeleteLink.originalUrl}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <button
                  type="button"
                  onClick={() => setPendingDeleteLink(null)}
                  disabled={deletingLinkId === pendingDeleteLink.id}
                  aria-label={`Cancel delete tracked link ${pendingDeleteLink.shortCode}`}
                  className="pib-btn-secondary text-xs disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteLink(pendingDeleteLink)}
                  disabled={deletingLinkId === pendingDeleteLink.id}
                  aria-label={`Confirm delete tracked link ${pendingDeleteLink.shortCode}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-50 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">delete</span>
                  {deletingLinkId === pendingDeleteLink.id ? 'Deleting...' : 'Delete link'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-outline-variant)] bg-[var(--color-surface-container-high)]">
                <th className="px-4 py-3 text-left font-semibold">Short URL</th>
                <th className="px-4 py-3 text-left font-semibold">Original URL</th>
                <th className="px-4 py-3 text-right font-semibold">Clicks</th>
                <th className="px-4 py-3 text-left font-semibold">Created</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-[var(--color-outline-variant)]">
                    <td className="px-4 py-4" colSpan={5}>
                      <div className="pib-skeleton h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : links.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-on-surface-variant)]">
                    No shortened links yet. Create one above!
                  </td>
                </tr>
              ) : (
                links.map(link => (
                  <tr
                    key={link.id}
                    className="cursor-pointer border-b border-[var(--color-outline-variant)] transition-colors hover:bg-[var(--color-surface-container-high)]"
                    onClick={() => fetchLinkStats(link.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-[var(--color-surface-container-high)] px-2 py-1 font-mono text-xs text-[var(--color-accent-v2)]">
                          {link.shortCode}
                        </code>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            void handleCopyLink(link.shortUrl)
                          }}
                          aria-label={`Copy tracked link ${link.shortCode}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-on-surface)]"
                        >
                          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">content_copy</span>
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={link.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-xs truncate text-xs text-blue-400 hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {link.originalUrl.substring(0, 50)}
                        {link.originalUrl.length > 50 ? '...' : ''}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--color-accent-v2)]">
                      {link.clickCount}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-on-surface-variant)]">
                      {formatCreatedDate(link.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setError('')
                          setPendingDeleteLink(link)
                        }}
                        aria-label={`Delete tracked link ${link.shortCode}`}
                        className="text-xs font-medium text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalLinks > LIMIT && (
          <div className="flex items-center justify-between border-t border-[var(--color-outline-variant)] px-4 py-3">
            <p className="text-xs text-[var(--color-on-surface-variant)]">
              Showing {(page - 1) * LIMIT + 1} to {Math.min(page * LIMIT, totalLinks)} of {totalLinks}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="pib-btn-secondary px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage(p => (p * LIMIT < totalLinks ? p + 1 : p))}
                disabled={page * LIMIT >= totalLinks}
                className="pib-btn-secondary px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
