'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { SeoArticle, SeoArticleStatus } from '@/lib/content/types'

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const STATUS_STYLES: Record<SeoArticleStatus, string> = {
  draft: 'bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text-muted)]',
  scheduled: 'bg-[var(--color-pib-amber-soft)] text-[var(--color-pib-amber)]',
  published: 'bg-[var(--color-pib-green-soft)] text-[var(--color-pib-green)]',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return '-'
  }
}

export default function SeoArticlesPage() {
  const router = useRouter()
  const [articles, setArticles] = useState<SeoArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState<'all' | SeoArticleStatus>('all')

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/content/seo')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load articles')
        setArticles([])
      } else {
        setArticles((body.data ?? []) as SeoArticle[])
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load articles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const counts = useMemo(() => {
    return {
      total: articles.length,
      published: articles.filter((a) => a.status === 'published').length,
      drafts: articles.filter((a) => a.status === 'draft').length,
      views: articles.reduce((acc, a) => acc + (a.views ?? 0), 0),
    }
  }, [articles])

  const visible = useMemo(
    () => (filter === 'all' ? articles : articles.filter((a) => a.status === filter)),
    [articles, filter],
  )

  async function createArticle() {
    setCreating(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/content/seo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled article' }),
      })
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to create article')
        return
      }
      const created = body.data as SeoArticle
      router.push(`/admin/content/seo/${created.id}`)
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to create article')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Content · SEO</p>
          <h1 className="pib-page-title mt-2">SEO Articles</h1>
          <p className="pib-page-sub max-w-2xl">
            Write, optimise, schedule and publish SEO content for the platform site. Each article is scored
            live for on-page SEO and readability.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <button onClick={createArticle} disabled={creating} className="st-btn st-btn--primary">
            {creating ? 'Creating…' : '+ New article'}
          </button>
          <Link href="/admin/content/analytics" className="st-btn st-btn--ghost">
            Analytics
          </Link>
        </div>
      </header>

      {topError && (
        <div className="st-panel px-4 py-3 text-sm text-[var(--color-error)]">{topError}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="pib-stat-card">
          <p className="sc-tiny">Total</p>
          <p className="text-2xl font-headline font-medium text-[var(--color-pib-text)] mt-1">{counts.total}</p>
        </div>
        <div className="pib-stat-card">
          <p className="sc-tiny">Published</p>
          <p className="text-2xl font-headline font-medium text-[var(--color-pib-text)] mt-1">{counts.published}</p>
        </div>
        <div className="pib-stat-card">
          <p className="sc-tiny">Drafts</p>
          <p className="text-2xl font-headline font-medium text-[var(--color-pib-text)] mt-1">{counts.drafts}</p>
        </div>
        <div className="pib-stat-card">
          <p className="sc-tiny">Total views</p>
          <p className="text-2xl font-headline font-medium text-[var(--color-pib-text)] mt-1">{counts.views.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {(['all', 'published', 'scheduled', 'draft'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs font-label px-3 py-1.5 rounded capitalize transition-colors ${
              filter === f ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
            }`}
            style={filter === f ? { background: 'var(--color-pib-green)', color: 'var(--color-pib-ink)' } : undefined}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-[6px]" />
          <Skeleton className="h-14 rounded-[6px]" />
          <Skeleton className="h-14 rounded-[6px]" />
        </div>
      ) : visible.length === 0 ? (
        <div className="st-panel p-8 text-center">
          <p className="text-sm text-[var(--color-pib-text-muted)]">No articles {filter !== 'all' ? `with status “${filter}”` : 'yet'}.</p>
          <button onClick={createArticle} disabled={creating} className="st-btn st-btn--primary text-sm font-label mt-4">
            + New article
          </button>
        </div>
      ) : (
        <div className="st-panel overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)] text-left">
                <th className="px-4 py-3 font-label text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Title</th>
                <th className="px-4 py-3 font-label text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Status</th>
                <th className="px-4 py-3 font-label text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] text-right">Views</th>
                <th className="px-4 py-3 font-label text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Published</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className="border-b border-[var(--color-pib-line)] last:border-0 hover:bg-[var(--color-row-hover)] transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/content/seo/${a.id}`} className="block">
                      <span className="text-[var(--color-pib-text)] font-medium">{a.title}</span>
                      <span className="block text-xs text-[var(--color-pib-text-muted)] font-mono mt-0.5">/{a.slug}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_STYLES[a.status]}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--color-pib-text)] tabular-nums">{(a.views ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">
                    {a.status === 'scheduled' ? `→ ${fmtDate(a.scheduledFor)}` : fmtDate(a.publishedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
