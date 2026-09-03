'use client'

import { useEffect, useMemo, useState } from 'react'
import { listBookFormats, type BookFormat, type BookFormatId } from '@/lib/book-studio/format-registry'
import { BOOK_TEMPLATE_PRESETS, getBookTemplatePreset } from '@/lib/book-studio/templates'
import { createBookStudioRecord, type BookStudioSurface } from '@/lib/book-studio/client'

type NewBookDialogProps = {
  orgId: string
  surface: BookStudioSurface
  open: boolean
  onClose: () => void
  onCreated: (projectId: string) => void
}

const FORMAT_GROUPS: Array<{ label: string; ids: BookFormatId[] }> = [
  { label: 'Text books', ids: ['story', 'nonfiction'] },
  { label: 'Visual books', ids: ['kids_picture', 'colouring', 'comic'] },
  { label: 'Puzzle & activity', ids: ['activity_workbook', 'puzzle_sudoku', 'puzzle_word_search', 'puzzle_maze', 'puzzle_crossword', 'puzzle_mixed'] },
]

function assemblyLabel(format: BookFormat): string {
  return format.assembly.includes('epub') ? 'PDF + EPUB' : 'PDF'
}

export function NewBookDialog({ orgId, surface, open, onClose, onCreated }: NewBookDialogProps) {
  const formats = useMemo(() => listBookFormats(), [])
  const [formatId, setFormatId] = useState<BookFormatId | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState('')
  const [trimId, setTrimId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Reset any stale selections when the dialog reopens, so a parent that
  // keeps the instance mounted never shows the previous draft.
  useEffect(() => {
    if (!open) return
    setFormatId(null)
    setTemplateId(null)
    setTitle('')
    setAudience('')
    setTrimId('')
    setBusy(false)
    setError('')
  }, [open])

  if (!open) return null

  const format = formatId ? formats.find((entry) => entry.id === formatId) ?? null : null
  const templates = BOOK_TEMPLATE_PRESETS.filter((preset) => preset.format === formatId)

  function pickFormat(id: BookFormatId) {
    setFormatId(id)
    setTemplateId(null)
    setError('')
    const selected = formats.find((entry) => entry.id === id)
    setTrimId(selected?.defaultTrim ?? '')
  }

  function changeFormat() {
    setFormatId(null)
    setTemplateId(null)
    setError('')
  }

  async function create() {
    if (!formatId) return
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    setBusy(true)
    setError('')
    try {
      const preset = templateId ? getBookTemplatePreset(templateId) : null
      const projectResult = await createBookStudioRecord<{ id: string }>('projects', orgId, {
        title: title.trim(),
        format: formatId,
        trim: trimId ? { presetId: trimId } : undefined,
        stylePrompt: audience.trim() ? `Audience: ${audience.trim()}` : undefined,
        stage: preset?.stage,
        safeSummary: preset && !preset.starterChapters ? preset.description : undefined,
      }, surface)
      if (!projectResult.ok) {
        setError(projectResult.error)
        return
      }
      const projectId = projectResult.data.id
      const starters = preset?.starterChapters ?? []
      let chaptersFailed = false
      try {
        for (const [order, chapter] of starters.entries()) {
          const chapterResult = await createBookStudioRecord('chapters', orgId, { projectId, title: chapter.title, order }, surface)
          if (!chapterResult.ok) {
            chaptersFailed = true
            break
          }
        }
      } catch {
        chaptersFailed = true
      }
      if (chaptersFailed) {
        setError('Project created, but some starter chapters could not be added  -  open the book to add them manually.')
      }
      // The project exists either way  -  hand the user into the workspace
      // rather than leaving them stuck in the dialog.
      onCreated(projectId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-label="New book" className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-black/50 p-2 sm:items-center sm:p-4">
      <div data-testid="new-book-panel" className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[6px] border border-[var(--color-pib-border)] bg-[var(--color-pib-surface)] sm:max-h-[calc(100dvh-2rem)]">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-pib-border)] px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="text-lg text-[var(--color-pib-text)]">New book</h2>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>

        <div data-testid="new-book-scroll-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {!format ? (
          <div className="space-y-6">
            {FORMAT_GROUPS.map((group) => (
              <div key={group.label}>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  {group.label}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.ids.map((id) => {
                    const entry = formats.find((item) => item.id === id)
                    if (!entry) return null
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => pickFormat(id)}
                        className="rounded-[6px] border border-[var(--color-pib-border)] bg-[var(--color-pib-surface)] p-4 text-left transition hover:border-[var(--color-pib-brand)]"
                      >
                        <div className="text-sm text-[var(--color-pib-text)]">{entry.label}</div>
                        <div className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                          {entry.layout === 'reflowable' ? 'Text chapters' : 'Fixed pages'} · {entry.defaultTrim} · {assemblyLabel(entry)}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <button type="button" onClick={changeFormat} className="text-xs text-[var(--color-pib-brand)] underline">
              Change format
            </button>

            {templates.length > 0 && (
              <div>
                <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  Template
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {templates.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={templateId === preset.id}
                      onClick={() => setTemplateId(preset.id === templateId ? null : preset.id)}
                      className={`rounded border px-3 py-1 text-xs  transition ${
                        templateId === preset.id
                          ? 'border-[var(--color-pib-brand)] bg-[var(--color-pib-brand)] text-white'
                          : 'border-[var(--color-pib-border)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Title</span>
              <input
                className="input-field w-full"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
               aria-label="Input"/>
            </label>

            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Audience</span>
              <input
                className="input-field w-full"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
               aria-label="Input"/>
            </label>

            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Trim size</span>
              <select
                className="input-field w-full"
                value={trimId}
                onChange={(event) => setTrimId(event.target.value)}
               aria-label="Input">
                {format.supportedTrims.map((trim) => (
                  <option key={trim} value={trim}>
                    {trim}
                  </option>
                ))}
              </select>
            </label>

            {error && (
              <p role="alert" className="text-sm text-[var(--color-pib-danger,#dc2626)]">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={() => void create()}
              >
                Create book
              </button>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
