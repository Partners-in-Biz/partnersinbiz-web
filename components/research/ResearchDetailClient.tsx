'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type {
  ResearchFindingStatus,
  ResearchItem,
  ResearchSource,
  ResearchStatus,
  ResearchVisibility,
} from '@/lib/research/types'
import {
  RESEARCH_FINDING_STATUSES,
  RESEARCH_STATUSES,
  RESEARCH_VISIBILITIES,
} from '@/lib/research/types'

type Comment = {
  id: string
  body: string
  createdBy?: string
  createdAt?: unknown
  anchor?: { type?: string; id?: string; text?: string }
}

type Props = {
  id: string
  mode: 'admin' | 'portal'
  basePath: string
  documentsBasePath?: string
}

function label(value: string) {
  return value.replaceAll('_', ' ')
}

function formatDate(value: unknown) {
  if (!value || typeof value !== 'string') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function ResearchDetailClient({ id, mode, basePath, documentsBasePath = '/admin/documents' }: Props) {
  const [item, setItem] = useState<ResearchItem | null>(null)
  const [sources, setSources] = useState<ResearchSource[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [summary, setSummary] = useState('')
  const [notesMarkdown, setNotesMarkdown] = useState('')
  const [status, setStatus] = useState<ResearchStatus>('draft')
  const [visibility, setVisibility] = useState<ResearchVisibility>('internal')
  const [newComment, setNewComment] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setError('')
    const detailPath = mode === 'portal' ? `/api/v1/portal/research/${id}` : `/api/v1/research/${id}`
    const detailRes = await fetch(detailPath)
    const detailBody = await detailRes.json().catch(() => null)
    if (!detailRes.ok) throw new Error(detailBody?.error ?? 'Could not load research')
    const nextItem: ResearchItem = mode === 'portal' ? detailBody.data.item : detailBody.data
    const nextSources: ResearchSource[] = mode === 'portal'
      ? detailBody.data.sources ?? []
      : await fetch(`/api/v1/research/${id}/sources`).then((res) => res.json()).then((body) => body.data ?? [])
    setItem(nextItem)
    setSources(nextSources)
    setSummary(nextItem.summary ?? '')
    setNotesMarkdown(nextItem.notesMarkdown ?? '')
    setStatus(nextItem.status)
    setVisibility(nextItem.visibility)

    const commentsPath = mode === 'portal'
      ? `/api/v1/portal/research/${id}/comments`
      : `/api/v1/comments?orgId=${encodeURIComponent(nextItem.orgId)}&resourceType=research_item&resourceId=${encodeURIComponent(id)}`
    const commentsRes = await fetch(commentsPath)
    const commentsBody = await commentsRes.json().catch(() => null)
    if (commentsRes.ok) setComments(commentsBody.data ?? [])
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load research'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode])

  async function patchItem(patch: Partial<ResearchItem>) {
    if (!item || mode !== 'admin') return
    setBusy('Saving')
    setError('')
    try {
      const res = await fetch(`/api/v1/research/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Could not save research')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save research')
    } finally {
      setBusy('')
    }
  }

  async function addSource() {
    if (!sourceTitle.trim() || mode !== 'admin') return
    setBusy('Adding source')
    setError('')
    try {
      const res = await fetch(`/api/v1/research/${id}/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: sourceTitle, url: sourceUrl, type: sourceUrl ? 'url' : 'note' }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Could not add source')
      setSourceTitle('')
      setSourceUrl('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add source')
    } finally {
      setBusy('')
    }
  }

  async function postComment(anchor: Record<string, unknown> = { type: 'item' }) {
    if (!item || !newComment.trim()) return
    setBusy('Commenting')
    setError('')
    const path = mode === 'portal' ? `/api/v1/portal/research/${id}/comments` : '/api/v1/comments'
    const payload = mode === 'portal'
      ? { body: newComment, anchor }
      : { orgId: item.orgId, resourceType: 'research_item', resourceId: id, body: newComment, anchor }
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Could not post comment')
      setNewComment('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post comment')
    } finally {
      setBusy('')
    }
  }

  async function runAction(path: string, labelText: string) {
    setBusy(labelText)
    setError('')
    try {
      const res = await fetch(path, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `${labelText} failed`)
      await load()
      return body?.data
    } catch (err) {
      setError(err instanceof Error ? err.message : `${labelText} failed`)
      return null
    } finally {
      setBusy('')
    }
  }

  if (error && !item) {
    return <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
  }

  if (!item) return <div className="pib-skeleton h-64" />

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={basePath} className="text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)]">Research</Link>
          <h1 className="pib-page-title mt-2">{item.title}</h1>
          <p className="pib-page-sub mt-2 max-w-3xl">{item.summary || 'Structured findings, evidence, and recommendations for this client workspace.'}</p>
        </div>
        {mode === 'admin' && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-pib-secondary" onClick={() => runAction(`/api/v1/research/${id}/export-obsidian`, 'Exporting')}>
              <span className="material-symbols-outlined text-base">sync</span>
              Export Obsidian
            </button>
            <button type="button" className="btn-pib-accent" onClick={async () => {
              const data = await runAction(`/api/v1/research/${id}/create-document`, 'Creating document')
              if (data?.documentId) window.location.href = `${documentsBasePath}/${data.documentId}`
            }}>
              <span className="material-symbols-outlined text-base">description</span>
              Create Report
            </button>
          </div>
        )}
      </header>

      {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {busy && <div className="rounded-md border border-[var(--color-border)] bg-black/20 px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">{busy}...</div>}

      <section className="grid gap-4 md:grid-cols-4">
        <div className="bento-card"><p className="eyebrow !text-[9px]">Kind</p><p className="mt-2 font-display text-xl">{label(item.kind)}</p></div>
        <div className="bento-card"><p className="eyebrow !text-[9px]">Status</p><p className="mt-2 font-display text-xl">{label(item.status)}</p></div>
        <div className="bento-card"><p className="eyebrow !text-[9px]">Visibility</p><p className="mt-2 font-display text-xl">{label(item.visibility)}</p></div>
        <div className="bento-card"><p className="eyebrow !text-[9px]">Obsidian</p><p className="mt-2 font-display text-xl">{item.obsidian?.exported ? 'Exported' : 'Not exported'}</p></div>
      </section>

      {mode === 'admin' && (
        <section className="bento-card space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <select value={status} onChange={(event) => setStatus(event.target.value as ResearchStatus)} className="rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm">
              {RESEARCH_STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
            </select>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as ResearchVisibility)} className="rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm">
              {RESEARCH_VISIBILITIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
            </select>
          </div>
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className="w-full rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm" placeholder="Research summary" />
          <textarea value={notesMarkdown} onChange={(event) => setNotesMarkdown(event.target.value)} rows={6} className="w-full rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm font-mono" placeholder="Working notes markdown" />
          <button type="button" className="btn-pib-accent" onClick={() => patchItem({ status, visibility, summary, notesMarkdown })}>
            <span className="material-symbols-outlined text-base">save</span>
            Save Research
          </button>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <section className="bento-card space-y-4">
            <h2 className="font-display text-2xl">Findings</h2>
            {item.findings.length === 0 ? <p className="text-sm text-[var(--color-pib-text-muted)]">No findings captured yet.</p> : item.findings.map((finding) => (
              <article key={finding.id} className="rounded-md border border-[var(--color-border)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg">{finding.title}</h3>
                    <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{finding.body}</p>
                  </div>
                  {mode === 'admin' && (
                    <select
                      value={finding.status}
                      onChange={(event) => {
                        const findings = item.findings.map((row) => row.id === finding.id ? { ...row, status: event.target.value as ResearchFindingStatus } : row)
                        patchItem({ findings })
                      }}
                      className="rounded-md border border-[var(--color-border)] bg-black/20 px-2 py-1 text-xs"
                    >
                      {RESEARCH_FINDING_STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
                    </select>
                  )}
                </div>
                <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Confidence: {finding.confidence} · Sources: {finding.sourceIds.join(', ') || 'none'}</p>
              </article>
            ))}
          </section>

          <section className="bento-card space-y-4">
            <h2 className="font-display text-2xl">Recommendations</h2>
            {item.recommendations.length === 0 ? <p className="text-sm text-[var(--color-pib-text-muted)]">No recommendations captured yet.</p> : item.recommendations.map((recommendation) => (
              <article key={recommendation.id} className="rounded-md border border-[var(--color-border)] p-4">
                <h3 className="font-display text-lg">{recommendation.title}</h3>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{recommendation.body}</p>
                <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Priority: {recommendation.priority} · Status: {recommendation.status}</p>
              </article>
            ))}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="bento-card space-y-4">
            <h2 className="font-display text-2xl">Sources</h2>
            {mode === 'admin' && (
              <div className="space-y-2">
                <input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Source title" className="w-full rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm" />
                <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Source URL" className="w-full rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm" />
                <button type="button" className="btn-pib-secondary !py-1.5 !text-sm" onClick={addSource}>
                  <span className="material-symbols-outlined text-base">add_link</span>
                  Add Source
                </button>
              </div>
            )}
            {sources.length === 0 ? <p className="text-sm text-[var(--color-pib-text-muted)]">No sources captured yet.</p> : sources.map((source) => (
              <article key={source.id} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                <h3 className="font-medium">{source.title}</h3>
                {source.url && <a href={source.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-[var(--color-pib-accent)]">{source.url}</a>}
                <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{source.type} · {source.confidence} · {source.verified ? 'verified' : 'unverified'}</p>
              </article>
            ))}
          </section>

          <section className="bento-card space-y-4">
            <h2 className="font-display text-2xl">Comments</h2>
            <textarea value={newComment} onChange={(event) => setNewComment(event.target.value)} rows={3} className="w-full rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm" placeholder="Comment on this research" />
            <button type="button" className="btn-pib-accent !py-1.5 !text-sm" onClick={() => postComment()}>
              <span className="material-symbols-outlined text-base">comment</span>
              Post Comment
            </button>
            <div className="space-y-3">
              {comments.map((comment) => (
                <article key={comment.id} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                  <p>{comment.body}</p>
                  <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{comment.createdBy ?? 'Someone'} {formatDate(comment.createdAt)}</p>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </div>
  )
}
