'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type SharedRecord = {
  id: string
  servingOrgId: string
  companyId: string
  fields: Record<string, unknown>
}

type SharedComment = {
  id: string
  body: string
  authorOrgId: string
  authorName?: string
  createdAt: unknown
}

type ClientApproval = {
  state: 'approved' | 'changes_requested'
  byOrgId?: string
  note?: string
}

type SharedWithUsSectionProps = {
  module: string
  /** Viewer org override (portal ?orgId= scope for PiB staff). */
  orgId?: string | null
  companyId?: string | null
  hrefForRecord?: (record: SharedRecord) => string
  title?: string
  emptyLabel?: string
  /** Show comment / approve controls inline (default true). */
  interactive?: boolean
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

function recordName(record: SharedRecord): string {
  const f = record.fields
  return String(f.siteName || f.name || f.title || f.subject || f.campaignName || record.id)
}

function approvalOf(record: SharedRecord): ClientApproval | null {
  const raw = record.fields.clientApproval
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (a.state !== 'approved' && a.state !== 'changes_requested') return null
  return { state: a.state, byOrgId: typeof a.byOrgId === 'string' ? a.byOrgId : undefined, note: typeof a.note === 'string' ? a.note : undefined }
}

/**
 * Client-side "Shared with us" list for a module. Fetches projected serving-org
 * records for the active org and lets the viewer comment / approve on each.
 */
export function SharedWithUsSection({
  module,
  orgId,
  companyId,
  hrefForRecord,
  title = 'Shared with us',
  emptyLabel = 'No partner work is shared with you for this module yet.',
  interactive = true,
}: SharedWithUsSectionProps) {
  const [records, setRecords] = useState<SharedRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [servingNames, setServingNames] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ module })
      if (companyId) qs.set('companyId', companyId)
      if (orgId) qs.set('orgId', orgId)
      const res = await fetch(`/api/v1/company-work/shared?${qs.toString()}`)
      const body = unwrap(await res.json().catch(() => null))
      if (!res.ok || signal.cancelled) return
      setRecords((body?.records as SharedRecord[]) ?? [])

      const companiesRes = await fetch(`/api/v1/company-work/shared${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''}`)
      const companiesBody = unwrap(await companiesRes.json().catch(() => null))
      if (companiesRes.ok && !signal.cancelled) {
        const map: Record<string, string> = {}
        for (const c of (companiesBody?.companies as Array<{ servingOrgId: string; servingOrgName: string }>) ?? []) {
          map[c.servingOrgId] = c.servingOrgName
        }
        setServingNames(map)
      }
    } finally {
      if (!signal.cancelled) setLoading(false)
    }
  }, [module, companyId, orgId])

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => { signal.cancelled = true }
  }, [load])

  // Most orgs have nothing shared into them; stay invisible until we know.
  if (loading || records.length === 0) return null

  return (
    <section className="mb-6 rounded-[var(--st-radius-raised)] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
      <h2 className="mb-3 text-sm text-[var(--color-pib-text)]">{title}</h2>
      <ul className="space-y-2">
        {records.map((record) => {
          const key = `${record.servingOrgId}:${record.id}`
          const by = servingNames[record.servingOrgId] || record.servingOrgId
          const href = hrefForRecord?.(record)
          const approval = approvalOf(record)
          const commentCount = Number(record.fields.clientCommentCount ?? 0) || 0
          const inner = (
            <>
              <span className="font-medium text-[var(--color-pib-text)]">{recordName(record)}</span>
              <span className="ml-2 rounded bg-[var(--color-accent-v2)]/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                by {by}
              </span>
              {record.fields.status ? (
                <span className="ml-2 text-[11px] text-[var(--color-pib-text-muted)]">{String(record.fields.status)}</span>
              ) : null}
              {approval ? (
                <span
                  className={`ml-2 rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                    approval.state === 'approved'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] text-[var(--st-warning)]'
                  }`}
                >
                  {approval.state === 'approved' ? 'Approved' : 'Changes requested'}
                </span>
              ) : null}
              {commentCount > 0 ? (
                <span className="ml-2 text-[11px] text-[var(--color-pib-text-muted)]">{commentCount} comment{commentCount === 1 ? '' : 's'}</span>
              ) : null}
            </>
          )
          return (
            <li key={key} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {href ? <Link href={href} className="hover:underline">{inner}</Link> : <div>{inner}</div>}
                {interactive ? (
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === key ? null : key)}
                    className="rounded border border-[var(--color-pib-line)] px-2.5 py-1 text-[11px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]"
                  >
                    {openId === key ? 'Close' : 'Comment / approve'}
                  </button>
                ) : null}
              </div>
              {interactive && openId === key ? (
                <SharedRecordActions
                  module={module}
                  orgId={orgId}
                  record={record}
                  onChanged={() => void load({ cancelled: false })}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
      {records.length === 0 ? (
        <p className="text-xs text-[var(--color-pib-text-muted)]">{emptyLabel}</p>
      ) : null}
    </section>
  )
}

function SharedRecordActions({
  module,
  orgId,
  record,
  onChanged,
}: {
  module: string
  orgId?: string | null
  record: SharedRecord
  onChanged: () => void
}) {
  const base = `/api/v1/company-work/shared/${encodeURIComponent(module)}/${encodeURIComponent(record.id)}`
  const orgQs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
  const [comments, setComments] = useState<SharedComment[]>([])
  const [loadingComments, setLoadingComments] = useState(true)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canComment, setCanComment] = useState(true)

  const loadComments = useCallback(async () => {
    setLoadingComments(true)
    try {
      const res = await fetch(`${base}/comments${orgQs}`)
      const body = unwrap(await res.json().catch(() => null))
      if (res.ok) setComments((body?.comments as SharedComment[]) ?? [])
      else if (res.status === 403) setCanComment(false)
    } finally {
      setLoadingComments(false)
    }
  }, [base, orgQs])

  useEffect(() => { void loadComments() }, [loadComments])

  async function post(path: string, payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/${path}${orgQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError(String(body?.error ?? body?.message ?? `Request failed (${res.status})`))
        return false
      }
      return true
    } finally {
      setBusy(false)
    }
  }

  async function submitComment() {
    if (!draft.trim()) return
    if (await post('comments', { body: draft })) {
      setDraft('')
      await loadComments()
      onChanged()
    }
  }

  async function submitApproval(state: 'approved' | 'changes_requested') {
    if (await post('approve', { state, note: draft.trim() || undefined })) {
      setDraft('')
      await loadComments()
      onChanged()
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
      {loadingComments ? (
        <p className="text-xs text-[var(--color-pib-text-muted)]">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-[var(--color-pib-text-muted)]">No comments yet.</p>
      ) : (
        <ul className="mb-2 space-y-1.5">
          {comments.map((c) => (
            <li key={c.id} className="text-xs text-[var(--color-pib-text)]">
              <span className="font-medium">{c.authorName || (c.authorOrgId === record.servingOrgId ? 'Partner' : 'You')}</span>
              <span className="text-[var(--color-pib-text-muted)]">: </span>
              {c.body}
            </li>
          ))}
        </ul>
      )}
      {canComment ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            aria-label={`Comment on ${recordName(record)}`}
            placeholder="Add a comment or a note with your decision…"
            className="w-full rounded-md border border-[var(--color-pib-line)] bg-transparent px-2 py-1.5 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void submitComment()}
              className="rounded border border-[var(--color-pib-line)] px-3 py-1 text-[11px] text-[var(--color-pib-text)] hover:bg-white/[0.05] disabled:opacity-50"
            >
              Comment
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitApproval('approved')}
              className="rounded bg-emerald-500/20 px-3 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitApproval('changes_requested')}
              className="rounded bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] px-3 py-1 text-[11px] text-[var(--st-warning)] hover:bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] disabled:opacity-50"
            >
              Request changes
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-[var(--color-pib-text-muted)]">View-only: your organisation can see this work but cannot comment on it.</p>
      )}
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  )
}
