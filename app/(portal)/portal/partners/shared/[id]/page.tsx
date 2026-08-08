'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface SharedView {
  share: {
    id: string
    resourceType: string
    resourceId: string
    resourceTitle?: string
    permission: string
    ownerOrgId: string
  }
  ownerOrgName: string
  record: Record<string, unknown>
  viewerRole: 'owner' | 'partner'
  canComment: boolean
}

interface ShareComment {
  id: string
  authorOrgId: string
  authorRef?: { displayName?: string }
  body: string
  createdAt?: { seconds?: number; _seconds?: number }
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

const HIDDEN_FIELDS = new Set(['id'])

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') {
    const ts = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    const seconds = ts.seconds ?? ts._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toLocaleString()
  }
  return JSON.stringify(value)
}

export default function SharedRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [view, setView] = useState<SharedView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [comments, setComments] = useState<ShareComment[]>([])
  const [canComment, setCanComment] = useState(false)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/crm/partner-shares/${id}/comments`)
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) return
      setComments((data?.comments as ShareComment[]) ?? [])
      setCanComment(Boolean(data?.canComment))
    } catch (err) {
      // Comments are secondary — a failure here must not blank the record.
      console.error('Failed to load share comments:', err)
    }
  }, [id])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/crm/partner-shares/${id}`)
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'This record is not available.')
        return
      }
      setView(data as unknown as SharedView)
      await loadComments()
    } catch {
      setError('This record is not available.')
    } finally {
      setLoading(false)
    }
  }, [id, loadComments])

  useEffect(() => { void load() }, [load])

  async function postComment() {
    if (!draft.trim()) return
    setPosting(true)
    setCommentError(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-shares/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setCommentError((data?.error as string) || 'Could not post the comment.')
        return
      }
      setDraft('')
      await loadComments()
    } finally {
      setPosting(false)
    }
  }

  function commentTime(c: ShareComment): string {
    const s = c.createdAt?.seconds ?? c.createdAt?._seconds
    return typeof s === 'number' ? new Date(s * 1000).toLocaleString() : ''
  }

  const lineItems = Array.isArray(view?.record.lineItems)
    ? view!.record.lineItems as Array<Record<string, unknown>>
    : null

  return (
    <div className="space-y-4 p-4">
      <Link href="/portal/partners" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
        ← Back to partners
      </Link>

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
          <h1 className="text-sm font-semibold text-rose-200">Not available</h1>
          <p className="mt-1 text-sm text-rose-300/90">{error}</p>
        </div>
      ) : view ? (
        <>
          <header>
            <p className="eyebrow">Shared by {view.ownerOrgName}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-pib-text)]">
              {view.share.resourceTitle || view.share.resourceId}
            </h1>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              {view.share.resourceType.replace('_', ' ')}
              {' · '}
              {view.share.permission === 'comment' ? 'can comment' : 'view only'}
              {' · '}
              {view.viewerRole === 'owner' ? 'you shared this out' : 'shared with your workspace'}
            </p>
          </header>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(view.record)
                .filter(([key]) => !HIDDEN_FIELDS.has(key) && key !== 'lineItems')
                .map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                      {humanise(key)}
                    </dt>
                    <dd className="truncate text-sm text-[var(--color-pib-text)]">{renderValue(value)}</dd>
                  </div>
                ))}
            </dl>
          </section>

          {lineItems && lineItems.length > 0 ? (
            <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">Line items</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                      <th className="pb-2 pr-3">Description</th>
                      <th className="pb-2 pr-3">Qty</th>
                      <th className="pb-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, i) => (
                      <tr key={i} className="border-b border-[var(--color-pib-line)] last:border-0">
                        <td className="py-2 pr-3 text-[var(--color-pib-text)]">{renderValue(item.description ?? item.name)}</td>
                        <td className="py-2 pr-3 text-[var(--color-pib-text-muted)]">{renderValue(item.quantity)}</td>
                        <td className="py-2 text-[var(--color-pib-text-muted)]">{renderValue(item.total ?? item.amount ?? item.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
              Conversation {comments.length > 0 ? `(${comments.length})` : ''}
            </h2>

            {comments.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No comments yet.</p>
            ) : (
              <ul className="space-y-3">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
                    <div className="mb-1 flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-medium text-[var(--color-pib-text)]">
                        {c.authorRef?.displayName || 'Someone'}
                      </span>
                      <span className="pib-pill px-1.5 py-0.5 text-[9px]">
                        {c.authorOrgId === view.share.ownerOrgId ? view.ownerOrgName : 'Partner'}
                      </span>
                      <span className="text-[10px] text-[var(--color-pib-text-muted)]">{commentTime(c)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--color-pib-text-muted)]">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {canComment ? (
              <div className="mt-4">
                <label htmlFor="share-comment" className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                  Add a comment
                </label>
                <textarea
                  id="share-comment"
                  rows={3}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ask a question or leave context for the other workspace…"
                  className="w-full rounded-lg border border-[var(--color-pib-line)] bg-black/20 px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-[var(--color-accent-v2)]"
                />
                {commentError ? (
                  <p className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {commentError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void postComment()}
                  disabled={posting || !draft.trim()}
                  className="mt-2 rounded-lg bg-[var(--color-accent-v2)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {posting ? 'Posting…' : 'Post comment'}
                </button>
              </div>
            ) : (
              <p className="mt-4 rounded-md border border-[var(--color-pib-line)] bg-black/20 px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                This record was shared with you as view-only, so you cannot comment. Ask {view.ownerOrgName} to
                enable commenting.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
