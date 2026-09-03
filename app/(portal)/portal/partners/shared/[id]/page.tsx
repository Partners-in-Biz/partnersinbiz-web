'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  ButtonLink,
  DataItem,
  DataList,
  Field,
  Notice,
  Panel,
  Skeleton,
  Status,
  Table,
  THead,
  TR,
  TH,
  TD,
  Textarea,
  Title,
} from '@/components/studio'

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
  if (value === null || value === undefined) return '-'
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
    <div className="space-y-8">
      <ButtonLink href="/portal/partners" variant="ghost" size="sm">Back to partners</ButtonLink>

      {loading ? (
        <div className="space-y-4">
          <Skeleton height="3rem" />
          <Skeleton height="10rem" />
        </div>
      ) : error ? (
        <EmptyState title="Not available." description={error} />
      ) : view ? (
        <>
          <PageHeader
            eyebrow={`Shared by ${view.ownerOrgName}`}
            title={`${view.share.resourceTitle || view.share.resourceId}.`}
            description={`${view.share.resourceType.replace('_', ' ')}. ${view.share.permission === 'comment' ? 'Can comment' : 'View only'}. ${view.viewerRole === 'owner' ? 'You shared this out' : 'Shared with your workspace'}.`}
          />

          <Panel>
            <DataList>
              {Object.entries(view.record)
                .filter(([key]) => !HIDDEN_FIELDS.has(key) && key !== 'lineItems')
                .map(([key, value]) => (
                  <DataItem key={key} label={humanise(key)}>
                    {renderValue(value)}
                  </DataItem>
                ))}
            </DataList>
          </Panel>

          {lineItems && lineItems.length > 0 ? (
            <Panel>
              <Title>Line items</Title>
              <div className="mt-4 overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Description</TH>
                      <TH>Qty</TH>
                      <TH>Amount</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {lineItems.map((item, i) => (
                      <TR key={i}>
                        <TD>{renderValue(item.description ?? item.name)}</TD>
                        <TD className="st-num">{renderValue(item.quantity)}</TD>
                        <TD className="st-num">{renderValue(item.total ?? item.amount ?? item.unitPrice)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Panel>
          ) : null}

          <Panel>
            <Title>
              Conversation {comments.length > 0 ? `(${comments.length})` : ''}
            </Title>

            {comments.length === 0 ? (
              <p className="mt-4 sc-body">No comments yet.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {comments.map((c) => (
                  <li key={c.id} className="st-panel st-panel--flat p-4">
                    <div className="mb-2 flex flex-wrap items-baseline gap-2">
                      <span className="sc-body text-[var(--sc-ink)]">
                        {c.authorRef?.displayName || 'Someone'}
                      </span>
                      <Status>
                        {c.authorOrgId === view.share.ownerOrgId ? view.ownerOrgName : 'Partner'}
                      </Status>
                      <span className="sc-tiny text-[var(--sc-ink-soft)]">{commentTime(c)}</span>
                    </div>
                    <p className="sc-body whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {canComment ? (
              <div className="mt-5 space-y-4">
                <Field id="share-comment" label="Add a comment">
                  <Textarea
                    id="share-comment"
                    aria-label="Add a comment"
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Ask a question or leave context for the other workspace."
                  />
                </Field>
                {commentError ? <Notice tone="danger">{commentError}</Notice> : null}
                <Button
                  type="button"
                  onClick={() => void postComment()}
                  disabled={posting || !draft.trim()}
                  loading={posting}
                >
                  Post comment
                </Button>
              </div>
            ) : (
              <Notice tone="info">
                This record was shared with you as view-only, so you cannot comment. Ask {view.ownerOrgName} to
                enable commenting.
              </Notice>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  )
}
