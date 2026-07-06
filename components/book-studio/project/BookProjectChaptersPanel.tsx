'use client'

import { useState } from 'react'
import { EmptyState, StatusPill, Surface } from '@/components/ui/AppFoundation'
import { humanizeToken, type BookChapter } from './types'

type BookProjectChaptersPanelProps = {
  chapters: BookChapter[]
  onEditBody: (chapterId: string, body: string) => void | Promise<void>
  onEditStatus: (chapterId: string, status: BookChapter['status']) => void | Promise<void>
  onAddChapter: (title: string) => void | Promise<void>
  addingChapter: boolean
}

const chapterStatuses: NonNullable<BookChapter['status']>[] = ['draft', 'edited', 'approved']

function ChapterRow({
  chapter,
  onEditBody,
  onEditStatus,
}: {
  chapter: BookChapter
  onEditBody: (body: string) => void
  onEditStatus: (status: BookChapter['status']) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState(chapter.body ?? '')

  return (
    <li className="rounded-2xl border border-[var(--color-pib-border)] p-4" aria-label={chapter.title ?? 'Chapter'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-pib-text)]">{chapter.title || 'Untitled chapter'}</p>
          <p className="text-xs text-[var(--color-pib-text-muted)]">{chapter.wordCount ?? 0} words</p>
        </div>
        <div className="flex items-center gap-2">
          {chapter.status ? <StatusPill tone={chapter.status === 'approved' ? 'success' : 'neutral'}>{humanizeToken(chapter.status)}</StatusPill> : null}
          <button type="button" className="btn-secondary" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 space-y-3 border-t border-[var(--color-pib-border)] pt-4">
          <label className="block space-y-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">Body</span>
            <textarea className="input-field w-full" rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" onClick={() => onEditBody(body)}>
              Save body
            </button>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">Status</span>
              <select
                className="input-field"
                value={chapter.status ?? 'draft'}
                onChange={(event) => onEditStatus(event.target.value as BookChapter['status'])}
              >
                {chapterStatuses.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function BookProjectChaptersPanel({ chapters, onEditBody, onEditStatus, onAddChapter, addingChapter }: BookProjectChaptersPanelProps) {
  const [newTitle, setNewTitle] = useState('')
  const ordered = [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!newTitle.trim()) return
    await onAddChapter(newTitle.trim())
    setNewTitle('')
  }

  return (
    <Surface header={<h2 className="text-lg font-semibold">Chapters</h2>}>
      <div className="space-y-4">
        <form className="flex gap-3" onSubmit={submit}>
          <input className="input-field flex-1" placeholder="New chapter title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
          <button type="submit" className="btn-secondary" disabled={addingChapter}>
            {addingChapter ? 'Adding…' : 'Add chapter'}
          </button>
        </form>

        {ordered.length === 0 ? (
          <EmptyState icon="menu_book" title="No chapters yet" description="Add the first chapter to start writing." />
        ) : (
          <ul className="space-y-3" aria-label="Book chapters">
            {ordered.map((chapter) => (
              <ChapterRow
                key={chapter.id}
                chapter={chapter}
                onEditBody={(body) => onEditBody(chapter.id, body)}
                onEditStatus={(status) => onEditStatus(chapter.id, status)}
              />
            ))}
          </ul>
        )}
      </div>
    </Surface>
  )
}
