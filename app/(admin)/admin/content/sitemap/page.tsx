'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'

interface SitemapPage {
  path: string
  source: 'static' | 'article'
  title: string
  excluded: boolean
  lastmod: string | null
}

interface PingLogEntry {
  id?: string
  action: 'regenerate' | 'gsc-submit'
  status: string
  message: string
  at: string
}

interface SitemapPayload {
  sitemapUrl: string
  origin: string
  totalPages: number
  totalEntries: number
  excludedPaths: string[]
  pages: SitemapPage[]
  lastRegeneratedAt: string | null
  lastGscSubmittedAt: string | null
  pingLog: PingLogEntry[]
  gscConfigured?: boolean
}

type PostAction =
  | { action: 'toggle-exclude'; path: string; excluded: boolean }
  | { action: 'regenerate' }
  | { action: 'gsc-submit' }

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function statusChip(status: string) {
  if (status === 'ok') {
    return (
      <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">
        {status}
      </span>
    )
  }
  if (status === 'not-configured') {
    return (
      <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">
        not configured
      </span>
    )
  }
  return (
    <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-on-surface/10 text-on-surface-variant">
      {status}
    </span>
  )
}

export default function SitemapManagerPage() {
  const [data, setData] = useState<SitemapPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [gscWarning, setGscWarning] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/content/sitemap')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load sitemap')
        setData(null)
      } else {
        setData((body.data ?? null) as SitemapPayload | null)
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load sitemap')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function post(payload: PostAction): Promise<SitemapPayload | null> {
    const res = await fetch('/api/v1/admin/content/sitemap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error ?? 'Request failed')
    return (body.data ?? null) as SitemapPayload | null
  }

  function applyResult(next: SitemapPayload | null) {
    if (next) setData(next)
  }

  async function handleRegenerate() {
    setRegenerating(true)
    setTopError(null)
    setNotice(null)
    setGscWarning(null)
    try {
      const next = await post({ action: 'regenerate' })
      applyResult(next)
      setNotice('Sitemap regenerated.')
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to regenerate sitemap')
    } finally {
      setRegenerating(false)
    }
  }

  async function handleGscSubmit() {
    setSubmitting(true)
    setTopError(null)
    setNotice(null)
    setGscWarning(null)
    try {
      const next = await post({ action: 'gsc-submit' })
      applyResult(next)
      const latest = next?.pingLog?.[0]
      const notConfigured =
        latest?.status === 'not-configured' || next?.gscConfigured === false
      if (notConfigured) {
        setGscWarning(
          'GSC not configured — the submission was recorded but not sent to Google. Configure GSC credentials to enable live submission.',
        )
      } else {
        setNotice('Sitemap submitted to Google Search Console.')
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to submit to GSC')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleExclude(page: SitemapPage) {
    setBusyPath(page.path)
    setTopError(null)
    setNotice(null)
    setGscWarning(null)
    try {
      const next = await post({
        action: 'toggle-exclude',
        path: page.path,
        excluded: !page.excluded,
      })
      applyResult(next)
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to update page')
    } finally {
      setBusyPath(null)
    }
  }

  const pingLog = useMemo(() => data?.pingLog ?? [], [data])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Content / Sitemap
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Sitemap Manager</h1>
          <p className="text-sm text-on-surface-variant mt-0.5 max-w-2xl">
            Review every URL in the public sitemap, exclude pages you don&apos;t want indexed,
            regenerate the file, and submit it to Google Search Console.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <button
            onClick={handleRegenerate}
            disabled={regenerating || submitting}
            className="pib-btn-primary text-sm font-label inline-flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-base">sync</span>
            {regenerating ? 'Regenerating...' : 'Regenerate'}
          </button>
          <button
            onClick={handleGscSubmit}
            disabled={submitting || regenerating}
            className="pib-btn-secondary text-sm font-label inline-flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-base">send</span>
            {submitting ? 'Submitting...' : 'Submit to GSC'}
          </button>
        </div>
      </div>

      {topError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {topError}
        </div>
      )}

      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      {gscWarning && (
        <div className="pib-card border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400 flex items-start gap-2">
          <span className="material-symbols-outlined text-base">warning</span>
          <span>{gscWarning}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : !data ? (
        <div className="pib-card p-8 text-center">
          <p className="text-sm text-on-surface-variant">No sitemap data available.</p>
        </div>
      ) : (
        <>
          {/* Info card */}
          <div className="pib-card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
                  Canonical sitemap
                </p>
                <a
                  href={data.sitemapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm break-all hover:underline"
                  style={{ color: 'var(--color-accent-v2)' }}
                >
                  {data.sitemapUrl}
                </a>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 shrink-0">
                <div>
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    Pages
                  </p>
                  <p className="text-xl font-headline font-bold text-on-surface mt-0.5">
                    {data.totalPages}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    Entries
                  </p>
                  <p className="text-xl font-headline font-bold text-on-surface mt-0.5">
                    {data.totalEntries}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    Last regenerated
                  </p>
                  <p className="text-xs text-on-surface mt-1">{fmt(data.lastRegeneratedAt)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    Last GSC submit
                  </p>
                  <p className="text-xs text-on-surface mt-1">{fmt(data.lastGscSubmittedAt)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Pages table */}
          <div className="pib-card p-0 overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--color-card-border)]">
              <h2 className="text-base font-headline font-bold text-on-surface">Pages</h2>
            </div>
            {data.pages.length === 0 ? (
              <div className="p-8 text-center text-sm text-on-surface-variant">
                No pages found in the sitemap.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      <th className="px-5 py-2 font-label">Path</th>
                      <th className="px-3 py-2 font-label">Source</th>
                      <th className="px-3 py-2 font-label">Title</th>
                      <th className="px-3 py-2 font-label">Last modified</th>
                      <th className="px-5 py-2 font-label text-right">Included</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pages.map((page) => {
                      const busy = busyPath === page.path
                      return (
                        <tr
                          key={page.path}
                          className={`border-t border-[var(--color-card-border)] ${
                            page.excluded ? 'opacity-50' : ''
                          }`}
                        >
                          <td className="px-5 py-2.5 font-mono text-xs text-on-surface break-all">
                            {page.path}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full ${
                                page.source === 'article'
                                  ? 'bg-on-surface/10 text-on-surface-variant'
                                  : ''
                              }`}
                              style={
                                page.source === 'static'
                                  ? {
                                      background: 'var(--color-accent-v2)20',
                                      color: 'var(--color-accent-v2)',
                                    }
                                  : undefined
                              }
                            >
                              {page.source}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-on-surface-variant max-w-xs truncate">
                            {page.title || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-on-surface-variant whitespace-nowrap">
                            {fmt(page.lastmod)}
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <label className="inline-flex items-center gap-2 cursor-pointer justify-end">
                              {busy && (
                                <span className="text-[10px] text-on-surface-variant">…</span>
                              )}
                              <input
                                type="checkbox"
                                checked={!page.excluded}
                                disabled={busy}
                                onChange={() => toggleExclude(page)}
                                className="h-4 w-4"
                              />
                              <span className="text-xs text-on-surface-variant sr-only">
                                Included
                              </span>
                            </label>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Ping log */}
          <div className="pib-card p-5">
            <h2 className="text-base font-headline font-bold text-on-surface mb-3">Ping log</h2>
            {pingLog.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No activity recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {pingLog.map((entry, i) => (
                  <li
                    key={entry.id ?? `${entry.at}-${i}`}
                    className="flex items-start gap-3 rounded-md border border-[var(--color-card-border)] px-3 py-2"
                  >
                    <span className="material-symbols-outlined text-base text-on-surface-variant mt-0.5">
                      {entry.action === 'regenerate' ? 'sync' : 'send'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {statusChip(entry.status)}
                        <span className="text-[11px] text-on-surface-variant">{fmt(entry.at)}</span>
                      </div>
                      <p className="text-sm text-on-surface mt-1">{entry.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
