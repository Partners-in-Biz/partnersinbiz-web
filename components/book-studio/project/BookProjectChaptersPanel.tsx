'use client'

import { useMemo, useState } from 'react'
import { EmptyState, StatusPill, Surface } from '@/components/ui/AppFoundation'
import { ChapterEditor } from './ChapterEditor'
import { humanizeToken, type BookChapter } from './types'

type BookProjectChaptersPanelProps = {
  chapters: BookChapter[]
  /** Persist a chapter body. Must resolve `true` only when the save succeeded. */
  onEditBody: (chapterId: string, body: string) => Promise<boolean> | boolean
  onEditStatus: (chapterId: string, status: BookChapter['status']) => void | Promise<void>
  onAddChapter: (title: string) => void | Promise<void>
  addingChapter: boolean
  readOnly?: boolean
  canApprove?: boolean
  canDelete?: boolean
  onRequestDraft?: (chapterId: string) => void | Promise<void>
  onMoveChapter?: (chapterId: string, direction: 'up' | 'down') => void | Promise<void>
}

const chapterStatuses: NonNullable<BookChapter['status']>[] = ['draft', 'generated', 'edited', 'approved']

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function chapterWordCount(chapter: BookChapter): number {
  if (typeof chapter.wordCount === 'number') return chapter.wordCount
  return countWords(chapter.body ?? '')
}

export function BookProjectChaptersPanel({
  chapters,
  onEditBody,
  onEditStatus,
  onAddChapter,
  addingChapter,
  readOnly = false,
  canApprove = true,
  canDelete = true,
  onRequestDraft,
  onMoveChapter,
}: BookProjectChaptersPanelProps) {
  const ordered = useMemo(() => [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [chapters])
  const [selectedId, setSelectedId] = useState<string | undefined>(ordered[0]?.id)
  const [newTitle, setNewTitle] = useState('')
  const [requestingDraftId, setRequestingDraftId] = useState<string | null>(null)

  // canDelete reserved for a future per-chapter delete affordance; chapters
  // currently have no delete action, so it is threaded through but unused.
  void canDelete

  const selected = ordered.find((chapter) => chapter.id === selectedId) ?? ordered[0]
  const statusOptions = canApprove ? chapterStatuses : chapterStatuses.filter((option) => option !== 'approved')
  const totalWords = ordered.reduce((sum, chapter) => sum + chapterWordCount(chapter), 0)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!newTitle.trim()) return
    await onAddChapter(newTitle.trim())
    setNewTitle('')
  }

  async function handleSave(chapterId: string, body: string) {
    const saved = await onEditBody(chapterId, body)
    // Only promote after a CONFIRMED save  -  a failed body save must not flip
    // a 'generated' chapter to 'edited' (that transition engages the
    // canvas-sync anti-clobber guard, so it has to reflect a real edit).
    if (saved !== true) return
    const chapter = ordered.find((entry) => entry.id === chapterId)
    if (chapter?.status === 'generated') {
      await onEditStatus(chapterId, 'edited')
    }
  }

  async function handleRequestDraft(chapterId: string) {
    if (!onRequestDraft) return
    setRequestingDraftId(chapterId)
    try {
      await onRequestDraft(chapterId)
    } finally {
      setRequestingDraftId(null)
    }
  }

  return (
    <Surface header={<h2 className="text-lg">Chapters</h2>}>
      {ordered.length === 0 && !selected ? (
        <div className="space-y-4">
          {readOnly ? null : (
            <form className="flex gap-3" onSubmit={submit}>
              <input
                className="input-field flex-1"
                placeholder="New chapter title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
               aria-label="New chapter title"/>
              <button type="submit" className="btn-secondary" disabled={addingChapter}>
                {addingChapter ? 'Adding…' : 'Add chapter'}
              </button>
            </form>
          )}
          <EmptyState icon="menu_book" title="No chapters yet" description="Add the first chapter to start writing." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-3">
            <ul className="space-y-2" aria-label="Book chapters">
              {ordered.map((chapter, index) => {
                const isSelected = chapter.id === selected?.id
                return (
                  <li key={chapter.id} id={`chapter-${encodeURIComponent(chapter.id)}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(chapter.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={[
                        'w-full rounded-[6px] border p-3 text-left transition-colors',
                        isSelected
                          ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-surface-muted)]'
                          : 'border-[var(--color-pib-border)] hover:bg-[var(--color-pib-surface-muted)]',
                      ].join(' ')}
                    >
                      <p className="text-sm font-medium text-[var(--color-pib-text)]">{chapter.title || 'Untitled chapter'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-[var(--color-pib-text-muted)]">{chapterWordCount(chapter)} words</span>
                        {chapter.status ? (
                          <StatusPill tone={chapter.status === 'approved' ? 'success' : 'neutral'}>{humanizeToken(chapter.status)}</StatusPill>
                        ) : null}
                      </div>
                    </button>
                    {readOnly || !onMoveChapter ? null : (
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={index === 0}
                          onClick={() => onMoveChapter(chapter.id, 'up')}
                          aria-label={`Move ${chapter.title ?? 'chapter'} up`}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={index === ordered.length - 1}
                          onClick={() => onMoveChapter(chapter.id, 'down')}
                          aria-label={`Move ${chapter.title ?? 'chapter'} down`}
                        >
                          Down
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>

            {readOnly ? null : (
              <form className="flex flex-col gap-2" onSubmit={submit}>
                <input
                  className="input-field"
                  placeholder="New chapter title"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                 aria-label="New chapter title"/>
                <button type="submit" className="btn-secondary" disabled={addingChapter}>
                  {addingChapter ? 'Adding…' : 'Add chapter'}
                </button>
              </form>
            )}

            <p className="text-xs text-[var(--color-pib-text-muted)]">Total words: {totalWords}</p>
          </div>

          <div className="space-y-3">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--color-pib-text)]">{selected.title || 'Untitled chapter'}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Status</span>
                      {readOnly ? (
                        <StatusPill tone={selected.status === 'approved' ? 'success' : 'neutral'}>{humanizeToken(selected.status ?? 'draft')}</StatusPill>
                      ) : (
                        <select
                          className="input-field"
                          value={selected.status ?? 'draft'}
                          onChange={(event) => onEditStatus(selected.id, event.target.value as BookChapter['status'])}
                         aria-label="Input">
                          {statusOptions.map((option) => (
                            <option key={option} value={option}>
                              {humanizeToken(option)}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                    {onRequestDraft && !readOnly ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={requestingDraftId === selected.id}
                        onClick={() => handleRequestDraft(selected.id)}
                      >
                        {requestingDraftId === selected.id ? 'Requesting…' : 'Request AI draft'}
                      </button>
                    ) : null}
                  </div>
                </div>

                <ChapterEditor
                  key={selected.id}
                  chapterId={selected.id}
                  initialMarkdown={selected.body ?? ''}
                  readOnly={readOnly}
                  onSave={handleSave}
                />
              </>
            ) : null}
          </div>
        </div>
      )}
    </Surface>
  )
}
