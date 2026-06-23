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
  draft: 'bg-on-surface/10 text-on-surface-variant',
  scheduled: 'bg-amber-500/10 text-amber-400',
  published: 'bg-green-500/10 text-green-400',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return '—'
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
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Content / SEO</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">SEO Articles</h1>
          <p className="text-sm text-on-surface-variant mt-0.5 max-w-2xl">
            Write, optimise, schedule and publish SEO content for the platform site. Each article is scored
            live for on-page SEO and readability.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <button onClick={createArticle} disabled={creating} className="pib-btn-primary text-sm font-label">
            {creating ? 'Creating…' : '+ New article'}
          </button>
          <Link href="/admin/content/analytics" className="pib-btn-ghost text-sm font-label">
            Analytics
          </Link>
        </div>
      </div>

      {topError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">{topError}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Total</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">{counts.total}</p>
        </div>
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Published</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">{counts.published}</p>
        </div>
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Drafts</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">{counts.drafts}</p>
        </div>
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Total views</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">{counts.views.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {(['all', 'published', 'scheduled', 'draft'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs font-label px-3 py-1.5 rounded-full capitalize transition-colors ${
              filter === f ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            style={filter === f ? { background: 'var(--color-accent-v2)', color: '#0b0b0b' } : undefined}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : visible.length === 0 ? (
        <div className="pib-card p-8 text-center">
          <p className="text-sm text-on-surface-variant">No articles {filter !== 'all' ? `with status “${filter}”` : 'yet'}.</p>
          <button onClick={createArticle} disabled={creating} className="pib-btn-primary text-sm font-label mt-4">
            + New article
          </button>
        </div>
      ) : (
        <div className="pib-card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-card-border)] text-left">
                <th className="px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Title</th>
                <th className="px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Status</th>
                <th className="px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant text-right">Views</th>
                <th className="px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Published</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className="border-b border-[var(--color-card-border)] last:border-0 hover:bg-on-surface/5 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/content/seo/${a.id}`} className="block">
                      <span className="text-on-surface font-medium">{a.title}</span>
                      <span className="block text-xs text-on-surface-variant font-mono mt-0.5">/{a.slug}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_STYLES[a.status]}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-on-surface tabular-nums">{(a.views ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-on-surface-variant">
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
