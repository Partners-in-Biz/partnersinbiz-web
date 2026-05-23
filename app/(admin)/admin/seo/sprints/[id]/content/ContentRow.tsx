'use client'

import { useState } from 'react'

interface DraftPreview {
  body?: string
  metaDescription?: string
  wordCount?: number
  generatedBy?: string
}

interface Props {
  id: string
  title: string
  keyword: string
  phase: number | null
  type?: string
  status?: string
  publishDate?: string
  targetUrl?: string
  draftPostId?: string
  draft?: DraftPreview
}

export function ContentRow({
  title,
  keyword,
  phase,
  type,
  status,
  publishDate,
  targetUrl,
  draftPostId,
  draft,
}: Props) {
  const [open, setOpen] = useState(false)
  const phaseLabel = phase != null ? `P${phase}` : '—'
  const hasDraft = !!draftPostId && !!draft?.body

  return (
    <>
      <tr className="transition-colors hover:bg-white/[0.03]">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] transition hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={open ? 'Hide draft' : 'Show draft'}
            disabled={!draftPostId}
            title={draftPostId ? 'Show draft' : 'No draft yet'}
          >
            <span className="material-symbols-outlined text-base">{open ? 'expand_more' : 'chevron_right'}</span>
          </button>
        </td>
        <td className="px-4 py-3 font-medium text-[var(--color-pib-text)]">{title}</td>
        <td className="px-4 py-3 text-xs text-[var(--color-pib-text-muted)]">{keyword}</td>
        <td className="px-4 py-3 text-xs">{phaseLabel}</td>
        <td className="px-4 py-3 text-xs">{type ?? '—'}</td>
        <td className="px-4 py-3 text-xs">
          <span className="pib-pill">{status ?? '—'}</span>
        </td>
        <td className="px-4 py-3 text-xs">
          {publishDate ? new Date(publishDate).toISOString().slice(0, 10) : '—'}
        </td>
        <td className="px-4 py-3 text-xs">
          {targetUrl ? (
            <a href={targetUrl} className="text-[var(--color-pib-accent)] underline">
              link
            </a>
          ) : (
            '—'
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="bg-[var(--color-pib-surface-2)] px-6 py-4">
            {!draftPostId && (
              <div className="text-xs text-[var(--color-pib-text-muted)]">
                No draft yet. Generate one via{' '}
                <code>POST /api/v1/seo/content/{`{id}`}/draft</code>.
              </div>
            )}
            {draftPostId && !hasDraft && (
              <div className="text-xs text-red-300">
                Draft id <code>{draftPostId}</code> not found in <code>seo_drafts</code>.
              </div>
            )}
            {hasDraft && draft && (
              <div className="space-y-3">
                <div className="text-xs text-[var(--color-pib-text-muted)] flex gap-4">
                  <span>{draft.wordCount ?? '?'} words</span>
                  <span>generatedBy: {draft.generatedBy ?? '?'}</span>
                </div>
                {draft.metaDescription && (
                  <div className="text-xs italic text-[var(--color-pib-text-muted)]">
                    Meta: {draft.metaDescription}
                  </div>
                )}
                <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans max-h-[600px] overflow-y-auto bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] p-4 rounded border border-[var(--color-pib-line)]">
                  {draft.body}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
