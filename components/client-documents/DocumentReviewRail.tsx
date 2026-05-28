'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { ClientDocument, DocumentAssumption, DocumentComment, DocumentCommentReply } from '@/lib/client-documents/types'

function fmtTs(ts: unknown): string {
  if (!ts) return ''
  if (typeof ts === 'object' && ts !== null) {
    const candidate = ts as { seconds?: number; _seconds?: number; toDate?: () => Date }
    if (typeof candidate.toDate === 'function') return candidate.toDate().toLocaleString()
    const seconds = candidate.seconds ?? candidate._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toLocaleString()
  }
  if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts).toLocaleString()
  return ''
}

function anchorPreview(c: DocumentComment): string | null {
  if (c.anchor?.type === 'text') {
    const txt = c.anchor.text
    return `"${txt.length > 80 ? txt.slice(0, 80) + '…' : txt}"`
  }
  if (c.anchor?.type === 'image') return 'On an image'
  if (c.blockId) return 'On a section'
  return null
}

function CommentReply({ reply }: { reply: DocumentCommentReply }) {
  return (
    <div className="border-l-2 border-[var(--color-pib-line)] pl-3 py-1">
      <div className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
        <span className="font-medium text-on-surface">{reply.userName}</span>
        <span>{fmtTs(reply.createdAt)}</span>
      </div>
      <p className="text-xs text-on-surface mt-0.5 whitespace-pre-wrap">{reply.text}</p>
    </div>
  )
}

interface CommentItemProps {
  comment: DocumentComment
  isActive: boolean
  onScroll: () => void
  onResolve: (resolved: boolean) => Promise<void> | void
  onReply: (text: string) => Promise<void> | void
  registerRef: (el: HTMLDivElement | null) => void
}

function CommentItem({ comment, isActive, onScroll, onResolve, onReply, registerRef }: CommentItemProps) {
  const [busyResolve, setBusyResolve] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [busyReply, setBusyReply] = useState(false)
  const [showReply, setShowReply] = useState(false)
  const isResolved = comment.status === 'resolved'
  const replies = comment.replies ?? []

  async function handleResolve() {
    setBusyResolve(true)
    try {
      await onResolve(!isResolved)
    } finally {
      setBusyResolve(false)
    }
  }

  async function handleReplySubmit() {
    const trimmed = replyText.trim()
    if (!trimmed || busyReply) return
    setBusyReply(true)
    try {
      await onReply(trimmed)
      setReplyText('')
      setShowReply(false)
    } finally {
      setBusyReply(false)
    }
  }

  const preview = anchorPreview(comment)

  return (
    <div
      ref={registerRef}
      className={[
        'pib-card p-3 space-y-2 transition-all duration-200',
        isResolved ? 'opacity-60' : '',
        isActive ? 'ring-2 ring-[var(--color-pib-accent)] -translate-y-0.5' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium truncate">{comment.userName}</span>
          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">{comment.userRole}</span>
        </div>
        <span className="text-[10px] text-on-surface-variant shrink-0">{fmtTs(comment.createdAt)}</span>
      </div>

      {preview && (
        <button
          type="button"
          onClick={onScroll}
          className="block w-full text-left text-[11px] text-on-surface-variant italic hover:text-[var(--color-pib-accent)] truncate"
          title="Jump to anchor"
        >
          {preview}
        </button>
      )}

      <p className="text-sm whitespace-pre-wrap break-words">{comment.text}</p>

      {replies.length > 0 && (
        <div className="space-y-1.5">
          {replies.map((r) => <CommentReply key={r.id} reply={r} />)}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleResolve}
          disabled={busyResolve}
          className="text-[11px] font-medium px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-50"
        >
          {busyResolve ? '…' : isResolved ? 'Reopen' : 'Resolve'}
        </button>
        <button
          type="button"
          onClick={() => setShowReply((v) => !v)}
          className="text-[11px] font-medium px-2 py-1 rounded border border-white/10 hover:bg-white/5"
        >
          {showReply ? 'Cancel' : `Reply${replies.length ? ` (${replies.length})` : ''}`}
        </button>
      </div>

      {showReply && (
        <div className="space-y-2 pt-1">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            placeholder="Write a reply…"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)] resize-none"
          />
          <button
            type="button"
            onClick={handleReplySubmit}
            disabled={!replyText.trim() || busyReply}
            className="w-full rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ background: 'var(--color-pib-accent)', color: '#000' }}
          >
            {busyReply ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      )}
    </div>
  )
}

export interface DocumentReviewRailProps {
  document: ClientDocument
  comments: DocumentComment[]
  activeCommentId?: string | null
  onPublish?: () => void
  onResolve?: (commentId: string, resolved: boolean) => Promise<void> | void
  onReply?: (commentId: string, text: string) => Promise<void> | void
  onScrollToComment?: (commentId: string) => void
}

export function DocumentReviewRail({
  document,
  comments,
  activeCommentId,
  onPublish,
  onResolve,
  onReply,
  onScrollToComment,
}: DocumentReviewRailProps) {
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const refMap = useRef(new Map<string, HTMLDivElement | null>())

  const blockers = (document.assumptions ?? []).filter((assumption: DocumentAssumption) => {
    return assumption.status === 'open' && assumption.severity === 'blocks_publish'
  })

  const counts = useMemo(() => {
    const open = comments.filter((c) => c.status !== 'resolved').length
    return { open, all: comments.length }
  }, [comments])

  const visible = useMemo(() => {
    return filter === 'open' ? comments.filter((c) => c.status !== 'resolved') : comments
  }, [comments, filter])

  useEffect(() => {
    if (!activeCommentId) return
    const el = refMap.current.get(activeCommentId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeCommentId])

  return (
    <aside className="space-y-4">
      <div className="pib-card p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">Status</p>
        <p className="mt-2 text-lg font-medium capitalize">{document.status.replaceAll('_', ' ')}</p>
        {blockers.length > 0 && (
          <p className="mt-3 text-xs text-amber-300">
            {blockers.length} blocking assumption{blockers.length === 1 ? '' : 's'}
          </p>
        )}
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            disabled={blockers.length > 0}
            className="mt-4 w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--color-pib-accent)', color: '#000' }}
          >
            Publish to client
          </button>
        )}
      </div>

      <div className="pib-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">Comments</p>
          <PageTabs
            ariaLabel="Document comment filters"
            value={filter}
            onValueChange={(value) => setFilter(value as 'open' | 'all')}
            tabs={[
              { value: 'open', label: 'Open', badge: counts.open },
              { value: 'all', label: 'All', badge: counts.all },
            ]}
          />
        </div>

        {visible.length === 0 ? (
          <p className="text-xs text-on-surface-variant">
            {filter === 'open' ? 'No open comments. Highlight text or click an image to add one.' : 'No comments yet.'}
          </p>
        ) : (
          <div className="space-y-2">
            {visible.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                isActive={activeCommentId === c.id}
                onScroll={() => onScrollToComment?.(c.id)}
                onResolve={async (resolved) => { if (onResolve) await onResolve(c.id, resolved) }}
                onReply={async (text) => { if (onReply) await onReply(c.id, text) }}
                registerRef={(el) => { refMap.current.set(c.id, el) }}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
