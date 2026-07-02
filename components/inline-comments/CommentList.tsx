'use client'

import type { InlineComment } from './types'

interface Props {
  comments: InlineComment[]
  onScrollToAnchor?: (comment: InlineComment) => void
}

function formatTs(ts: unknown): string {
  const value = ts && typeof ts === 'object' ? ts as { _seconds?: unknown; seconds?: unknown } : null
  const sec = typeof value?._seconds === 'number' ? value._seconds : typeof value?.seconds === 'number' ? value.seconds : null
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return d.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Vertical list of comments with anchor previews. Comments anchored to a
 * specific text selection or image show a preview chip; clicking it scrolls
 * to that anchor in the body via the parent's onScrollToAnchor.
 */
export function CommentList({ comments, onScrollToAnchor }: Props) {
  if (comments.length === 0) {
    return (
      <div className="pib-card p-5 text-center">
        <p className="text-xs text-on-surface-variant">
          No comments yet. Highlight text or click an image to leave one.
        </p>
      </div>
    )
  }
  return (
    <ul className="space-y-3">
      {comments.map(c => {
        const anchored = !!c.anchor
        return (
          <li
            key={c.id}
            className="pib-card p-4 space-y-2"
            style={
              anchored
                ? {
                    borderLeft: '3px solid var(--org-accent, var(--color-pib-accent))',
                  }
                : undefined
            }
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-on-surface">{c.userName}</span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide"
                style={{
                  background:
                    c.userRole === 'client'
                      ? 'rgba(96,165,250,0.18)'
                      : 'rgba(245,166,35,0.18)',
                }}
              >
                {c.userRole}
              </span>
              {c.agentPickedUp && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide"
                  style={{ background: 'rgba(74,222,128,0.18)', color: '#4ade80' }}
                >
                  agent ✓
                </span>
              )}
              <span className="ml-auto text-on-surface-variant">{formatTs(c.createdAt)}</span>
            </div>
            {c.anchor?.type === 'text' && (
              <button
                type="button"
                onClick={() => onScrollToAnchor?.(c)}
                className="text-xs italic text-left text-on-surface-variant hover:text-on-surface bg-[var(--color-surface)] rounded px-2 py-1.5 -ml-1 max-w-full truncate block"
                title="Jump to selection"
              >
                Re: &ldquo;{c.anchor.text.slice(0, 100)}
                {c.anchor.text.length > 100 ? '…' : ''}&rdquo;
              </button>
            )}
            {c.anchor?.type === 'image' && (
              <button
                type="button"
                onClick={() => onScrollToAnchor?.(c)}
                className="flex items-center gap-2 text-xs text-on-surface-variant hover:text-on-surface"
                title="Jump to image"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.anchor.mediaUrl}
                  alt=""
                  className="w-10 h-10 rounded object-cover border border-[var(--org-border,var(--color-pib-line))]"
                />
                <span className="italic">Comment on image</span>
              </button>
            )}
            <p className="text-sm whitespace-pre-wrap">{c.text}</p>
          </li>
        )
      })}
    </ul>
  )
}
