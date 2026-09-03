import { Icon } from '@/components/studio'
'use client'

import { useState } from 'react'
import { DialogDrawer, EmptyState, StatusPill, Surface } from '@/components/ui/AppFoundation'
import type { PuzzleKind } from '@/lib/book-studio/format-registry'
import { humanizeToken, type BookPage, type BookPageKind } from './types'

type BookProjectPagesPanelProps = {
  pages: BookPage[]
  puzzleKind?: PuzzleKind
  onMove: (pageId: string, direction: 'up' | 'down') => void | Promise<void>
  onEdit: (pageId: string, patch: { title?: string; prompt?: string; caption?: string }) => void | Promise<void>
  onDelete: (pageId: string) => void | Promise<void>
  onAddPage: (input: { kind: BookPageKind; title?: string; prompt?: string }) => void | Promise<void>
  onRegeneratePuzzle: (page: BookPage) => void | Promise<void>
  onGeneratePuzzles: (input: {
    kind: string
    count: number
    difficulty: string
    words?: string[]
    entries?: { word: string; clue: string }[]
  }) => Promise<{ ok: boolean; error?: string }>
  addingPage: boolean
  regeneratingPageId: string | null
  generatingPuzzles: boolean
  readOnly?: boolean
  canApprove?: boolean
  canDelete?: boolean
  showOperatorTools?: boolean
}

const pageKindIcons: Record<BookPageKind, string> = {
  illustration: 'image',
  colouring: 'palette',
  comic: 'auto_awesome_mosaic',
  puzzle: 'extension',
  activity: 'checklist',
  text: 'article',
  front_matter: 'menu_book',
  back_matter: 'menu_book',
}

const pageKinds: BookPageKind[] = ['illustration', 'colouring', 'comic', 'puzzle', 'activity', 'text', 'front_matter', 'back_matter']
const difficulties = ['easy', 'medium', 'hard', 'expert']

function PageRow({
  page,
  index,
  total,
  onMove,
  onEdit,
  onDelete,
  onRegeneratePuzzle,
  regenerating,
  readOnly,
  canDelete,
  showOperatorTools,
}: {
  page: BookPage
  index: number
  total: number
  onMove: (direction: 'up' | 'down') => void
  onEdit: (patch: { title?: string; prompt?: string; caption?: string }) => void
  onDelete: () => void
  onRegeneratePuzzle: () => void
  regenerating: boolean
  readOnly: boolean
  canDelete: boolean
  showOperatorTools: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(page.title ?? '')
  const [prompt, setPrompt] = useState(page.prompt ?? '')
  const [caption, setCaption] = useState(page.caption ?? '')

  const isPuzzle = page.kind === 'puzzle'

  return (
    <li id={`page-${encodeURIComponent(page.id)}`} className="rounded-[6px] border border-[var(--color-pib-border)] p-4" aria-label={page.title ?? `Page ${index + 1}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          {page.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.imageUrl} alt="" className="h-14 w-14 rounded-lg border border-[var(--color-pib-border)] object-cover" />
          ) : (
            <Icon name={pageKindIcons[page.kind ?? 'text']} className="flex h-14 w-14 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--st-danger)_10%,transparent)] text-[var(--st-danger)]" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="rose">{humanizeToken(page.kind)}</StatusPill>
              {page.status ? <StatusPill tone={page.status === 'approved' ? 'success' : 'neutral'}>{humanizeToken(page.status)}</StatusPill> : null}
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{page.title || page.caption || `Page ${index + 1}`}</p>
            {isPuzzle && page.puzzle ? (
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                {page.puzzle.kind} · {page.puzzle.difficulty} · seed {page.puzzle.seed}
              </p>
            ) : null}
          </div>
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={index === 0} onClick={() => onMove('up')} aria-label={`Move ${page.title ?? 'page'} up`}>
              Up
            </button>
            <button type="button" className="btn-secondary" disabled={index === total - 1} onClick={() => onMove('down')} aria-label={`Move ${page.title ?? 'page'} down`}>
              Down
            </button>
            {isPuzzle ? (
              showOperatorTools ? (
                <button type="button" className="btn-secondary" disabled={regenerating} onClick={onRegeneratePuzzle}>
                  {regenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
              ) : null
            ) : (
              <button type="button" className="btn-secondary" onClick={() => setEditing((prev) => !prev)}>
                {editing ? 'Close' : 'Edit'}
              </button>
            )}
            {canDelete ? (
              <button type="button" className="btn-secondary" onClick={onDelete}>
                Delete
              </button>
            ) : null}
          </div>
        )}
      </div>

      {editing && !isPuzzle && !readOnly ? (
        <form
          className="mt-4 space-y-3 border-t border-[var(--color-pib-border)] pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            onEdit({ title, prompt, caption })
            setEditing(false)
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Title</span>
            <input className="input-field w-full" value={title} onChange={(event) => setTitle(event.target.value)}  aria-label="Input"/>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Prompt</span>
            <textarea className="input-field w-full" rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)}  aria-label="Input"/>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Caption</span>
            <input className="input-field w-full" value={caption} onChange={(event) => setCaption(event.target.value)}  aria-label="Input"/>
          </label>
          <button type="submit" className="btn-primary">Save page</button>
        </form>
      ) : null}
    </li>
  )
}

function GeneratePuzzlesDialog({
  open,
  puzzleKind,
  onClose,
  onGenerate,
  generating,
}: {
  open: boolean
  puzzleKind: PuzzleKind
  onClose: () => void
  onGenerate: (input: { kind: string; count: number; difficulty: string; words?: string[]; entries?: { word: string; clue: string }[] }) => Promise<{ ok: boolean; error?: string }>
  generating: boolean
}) {
  const isMixed = puzzleKind === 'mixed'
  const [kind, setKind] = useState<string>(isMixed ? 'word_search' : puzzleKind)
  const [count, setCount] = useState(5)
  const [difficulty, setDifficulty] = useState('medium')
  const [wordsText, setWordsText] = useState('')
  const [error, setError] = useState('')

  function parseEntries(lines: string[]): { word: string; clue: string }[] {
    const entries: { word: string; clue: string }[] = []
    for (const line of lines) {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex === -1) continue
      const word = line.slice(0, separatorIndex).trim()
      const clue = line.slice(separatorIndex + 1).trim()
      if (!word || !clue) continue
      entries.push({ word, clue })
    }
    return entries
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    const lines = wordsText.split('\n').map((line) => line.trim()).filter(Boolean)
    const isCrossword = kind === 'crossword'

    let entries: { word: string; clue: string }[] | undefined
    if (isCrossword) {
      entries = parseEntries(lines)
      if (lines.length && entries.length === 0) {
        setError('Enter at least one valid "word:clue" line')
        return
      }
      if (entries.length === 0) entries = undefined
    }

    const result = await onGenerate({
      kind,
      count,
      difficulty,
      words: !isCrossword && lines.length ? lines : undefined,
      entries,
    })
    if (!result.ok) {
      setError(result.error ?? 'Could not generate puzzles')
      return
    }
    onClose()
  }

  const showWordsInput = kind === 'word_search' || kind === 'crossword'

  return (
    <DialogDrawer open={open} title="Generate puzzles" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900" role="alert">{error}</p> : null}
        <label className="block space-y-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Kind</span>
          <select
            className="input-field w-full"
            value={kind}
            disabled={!isMixed}
            onChange={(event) => setKind(event.target.value)}
           aria-label="Input">
            {isMixed
              ? ['sudoku', 'word_search', 'maze', 'crossword'].map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)
              : <option value={kind}>{humanizeToken(kind)}</option>}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Count</span>
          <input
            type="number"
            min={1}
            max={100}
            className="input-field w-full"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
           aria-label="Number"/>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Difficulty</span>
          <select className="input-field w-full" value={difficulty} onChange={(event) => setDifficulty(event.target.value)} aria-label="Input">
            {difficulties.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}
          </select>
        </label>
        {showWordsInput ? (
          <label className="block space-y-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
              {kind === 'crossword' ? 'Entries (word:clue per line)' : 'Words (one per line)'}
            </span>
            <textarea
              className="input-field w-full"
              rows={5}
              value={wordsText}
              onChange={(event) => setWordsText(event.target.value)}
              placeholder={kind === 'crossword' ? 'OCEAN:Large body of salt water' : 'OCEAN'}
             aria-label="Input"/>
          </label>
        ) : null}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={generating}>
            {generating ? 'Generating…' : 'Generate puzzles'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={generating}>
            Cancel
          </button>
        </div>
      </form>
    </DialogDrawer>
  )
}

function AddPageForm({ onAddPage, adding }: { onAddPage: BookProjectPagesPanelProps['onAddPage']; adding: boolean }) {
  const [kind, setKind] = useState<BookPageKind>('illustration')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await onAddPage({ kind, title: title || undefined, prompt: prompt || undefined })
    setTitle('')
    setPrompt('')
  }

  return (
    <form className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]" onSubmit={submit}>
      <select className="input-field" value={kind} onChange={(event) => setKind(event.target.value as BookPageKind)} aria-label="Input">
        {pageKinds.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}
      </select>
      <input className="input-field" placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)}  aria-label="Title"/>
      <input className="input-field" placeholder="Prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)}  aria-label="Prompt"/>
      <button type="submit" className="btn-secondary" disabled={adding}>
        {adding ? 'Adding…' : 'Add page'}
      </button>
    </form>
  )
}

export function BookProjectPagesPanel({
  pages,
  puzzleKind,
  onMove,
  onEdit,
  onDelete,
  onAddPage,
  onRegeneratePuzzle,
  onGeneratePuzzles,
  addingPage,
  regeneratingPageId,
  generatingPuzzles,
  readOnly = false,
  canApprove = true,
  canDelete = true,
  showOperatorTools = true,
}: BookProjectPagesPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const ordered = [...pages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  // canApprove has no page-level status select to filter yet; threaded
  // through for parity with the chapters panel and future use.
  void canApprove
  const showGeneratePuzzles = Boolean(puzzleKind) && showOperatorTools && !readOnly

  return (
    <Surface
      header={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Pages</h2>
          {showGeneratePuzzles ? (
            <button type="button" className="btn-secondary" onClick={() => setDialogOpen(true)}>
              Generate puzzles
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {readOnly ? null : <AddPageForm onAddPage={onAddPage} adding={addingPage} />}

        {ordered.length === 0 ? (
          <EmptyState icon="auto_stories" title="No pages yet" description="Add a page or generate puzzles to get started." />
        ) : (
          <ul className="space-y-3" aria-label="Book pages">
            {ordered.map((page, index) => (
              <PageRow
                key={page.id}
                page={page}
                index={index}
                total={ordered.length}
                onMove={(direction) => onMove(page.id, direction)}
                onEdit={(patch) => onEdit(page.id, patch)}
                onDelete={() => onDelete(page.id)}
                onRegeneratePuzzle={() => onRegeneratePuzzle(page)}
                regenerating={regeneratingPageId === page.id}
                readOnly={readOnly}
                canDelete={canDelete}
                showOperatorTools={showOperatorTools}
              />
            ))}
          </ul>
        )}
      </div>

      {showGeneratePuzzles && puzzleKind ? (
        <GeneratePuzzlesDialog
          open={dialogOpen}
          puzzleKind={puzzleKind}
          onClose={() => setDialogOpen(false)}
          onGenerate={onGeneratePuzzles}
          generating={generatingPuzzles}
        />
      ) : null}
    </Surface>
  )
}
