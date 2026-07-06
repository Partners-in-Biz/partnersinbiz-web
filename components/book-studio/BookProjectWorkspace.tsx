'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell, PageTabs, Surface } from '@/components/ui/AppFoundation'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import {
  assembleBookStudioProject,
  createBookStudioRecord,
  deleteBookStudioRecord,
  generateBookStudioPuzzles,
  listBookStudioRecords,
  openBookStudioProjectInCanvas,
  patchBookStudioRecord,
  type GeneratePuzzlesPayload,
} from '@/lib/book-studio/client'
import { BookProjectHeader } from './project/BookProjectHeader'
import { BookProjectMetadataPanel } from './project/BookProjectMetadataPanel'
import { BookProjectPagesPanel } from './project/BookProjectPagesPanel'
import { BookProjectChaptersPanel } from './project/BookProjectChaptersPanel'
import { BookProjectAssemblyPanel } from './project/BookProjectAssemblyPanel'
import type { BookChapter, BookPage, BookPageKind, BookProject, BookProjectManifest, BookProjectMetadata } from './project/types'

type BookProjectWorkspaceProps = {
  orgId: string
  projectId: string
}

type Tab = 'content' | 'metadata' | 'assembly'

export function BookProjectWorkspace({ orgId, projectId }: BookProjectWorkspaceProps) {
  const [project, setProject] = useState<BookProject | null>(null)
  const [chapters, setChapters] = useState<BookChapter[]>([])
  const [pages, setPages] = useState<BookPage[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<Tab>('content')

  const [savingMetadata, setSavingMetadata] = useState(false)
  const [addingPage, setAddingPage] = useState(false)
  const [addingChapter, setAddingChapter] = useState(false)
  const [regeneratingPageId, setRegeneratingPageId] = useState<string | null>(null)
  const [generatingPuzzles, setGeneratingPuzzles] = useState(false)
  const [openingCanvas, setOpeningCanvas] = useState(false)
  const [assembling, setAssembling] = useState(false)
  const [assembleError, setAssembleError] = useState('')
  const [missingOrders, setMissingOrders] = useState<number[] | undefined>(undefined)
  const [manifest, setManifest] = useState<BookProjectManifest | undefined>(undefined)

  const loadRequestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const isCurrent = () => requestId === loadRequestIdRef.current
    setLoading(true)
    setNotice('')
    try {
      const [projectsRes, chaptersRes, pagesRes] = await Promise.all([
        listBookStudioRecords<BookProject>('projects', orgId),
        listBookStudioRecords<BookChapter>('chapters', orgId),
        listBookStudioRecords<BookPage>('pages', orgId),
      ])
      if (!isCurrent()) return

      if (!projectsRes.ok) {
        setNotice(projectsRes.error)
        setProject(null)
        return
      }
      const foundProject = (projectsRes.data.records ?? []).find((record) => record.id === projectId) ?? null
      setProject(foundProject)
      if (foundProject?.packageManifest) setManifest(foundProject.packageManifest)

      const allChapters = chaptersRes.ok ? chaptersRes.data.records ?? [] : []
      const allPages = pagesRes.ok ? pagesRes.data.records ?? [] : []
      setChapters(allChapters.filter((chapter) => (chapter as unknown as { projectId?: string }).projectId === projectId))
      setPages(allPages.filter((page) => (page as unknown as { projectId?: string }).projectId === projectId))

      if (!chaptersRes.ok || !pagesRes.ok) {
        setNotice('Could not load the full project workspace.')
      }
    } catch {
      if (!isCurrent()) return
      setNotice('Could not load the Book Studio project workspace.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [orgId, projectId])

  useEffect(() => {
    void load()
  }, [load])

  async function saveMetadata(metadata: BookProjectMetadata) {
    setSavingMetadata(true)
    setNotice('')
    try {
      const result = await patchBookStudioRecord('projects', projectId, orgId, { metadata })
      if (!result.ok) {
        setNotice(result.error)
        return
      }
      await load()
    } finally {
      setSavingMetadata(false)
    }
  }

  async function movePage(pageId: string, direction: 'up' | 'down') {
    const ordered = [...pages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const index = ordered.findIndex((page) => page.id === pageId)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return
    const current = ordered[index]
    const swap = ordered[swapIndex]
    const currentOrder = current.order ?? index
    const swapOrder = swap.order ?? swapIndex
    await Promise.all([
      patchBookStudioRecord('pages', current.id, orgId, { order: swapOrder }),
      patchBookStudioRecord('pages', swap.id, orgId, { order: currentOrder }),
    ])
    await load()
  }

  async function editPage(pageId: string, patch: { title?: string; prompt?: string; caption?: string }) {
    const result = await patchBookStudioRecord('pages', pageId, orgId, patch)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    await load()
  }

  async function deletePage(pageId: string) {
    const result = await deleteBookStudioRecord('pages', pageId, orgId)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    await load()
  }

  async function addPage(input: { kind: BookPageKind; title?: string; prompt?: string }) {
    setAddingPage(true)
    setNotice('')
    try {
      const maxOrder = pages.reduce((max, page) => Math.max(max, page.order ?? -1), -1)
      const result = await createBookStudioRecord('pages', orgId, {
        projectId,
        kind: input.kind,
        title: input.title,
        prompt: input.prompt,
        order: maxOrder + 1,
      })
      if (!result.ok) {
        setNotice(result.error)
        return
      }
      await load()
    } finally {
      setAddingPage(false)
    }
  }

  async function regeneratePuzzle(page: BookPage) {
    if (!page.puzzle?.kind) return
    setRegeneratingPageId(page.id)
    setNotice('')
    try {
      const deleteResult = await deleteBookStudioRecord('pages', page.id, orgId)
      if (!deleteResult.ok) {
        setNotice(deleteResult.error)
        return
      }
      const result = await generateBookStudioPuzzles(projectId, orgId, {
        kind: page.puzzle.kind as GeneratePuzzlesPayload['kind'],
        count: 1,
        difficulty: (page.puzzle.difficulty as GeneratePuzzlesPayload['difficulty']) ?? 'medium',
        startOrder: page.order,
      })
      if (!result.ok) {
        setNotice(result.error)
        return
      }
      await load()
    } finally {
      setRegeneratingPageId(null)
    }
  }

  async function generatePuzzles(input: { kind: string; count: number; difficulty: string; words?: string[]; entries?: string[] }) {
    setGeneratingPuzzles(true)
    setNotice('')
    try {
      const result = await generateBookStudioPuzzles(projectId, orgId, {
        kind: input.kind as GeneratePuzzlesPayload['kind'],
        count: input.count,
        difficulty: input.difficulty as GeneratePuzzlesPayload['difficulty'],
        params: input.words || input.entries ? { words: input.words, entries: input.entries } : undefined,
      })
      if (!result.ok) {
        return { ok: false, error: result.error }
      }
      await load()
      return { ok: true }
    } finally {
      setGeneratingPuzzles(false)
    }
  }

  async function editChapterBody(chapterId: string, body: string) {
    const result = await patchBookStudioRecord('chapters', chapterId, orgId, { body })
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    await load()
  }

  async function editChapterStatus(chapterId: string, status: BookChapter['status']) {
    const result = await patchBookStudioRecord('chapters', chapterId, orgId, { status })
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    await load()
  }

  async function addChapter(title: string) {
    setAddingChapter(true)
    setNotice('')
    try {
      const maxOrder = chapters.reduce((max, chapter) => Math.max(max, chapter.order ?? -1), -1)
      const result = await createBookStudioRecord('chapters', orgId, { projectId, title, order: maxOrder + 1 })
      if (!result.ok) {
        setNotice(result.error)
        return
      }
      await load()
    } finally {
      setAddingChapter(false)
    }
  }

  async function openInCanvas() {
    setOpeningCanvas(true)
    setNotice('')
    try {
      const result = await openBookStudioProjectInCanvas<{ canvasId?: string }>(projectId, orgId)
      if (!result.ok) {
        setNotice(result.error)
        return
      }
      const canvasId = result.data?.canvasId
      if (!canvasId) {
        setNotice('Canvas did not return an id')
        return
      }
      window.open(`/admin/creative-canvas?canvas=${encodeURIComponent(canvasId)}`, '_self')
    } finally {
      setOpeningCanvas(false)
    }
  }

  async function assemble() {
    setAssembling(true)
    setAssembleError('')
    setMissingOrders(undefined)
    setNotice('')
    try {
      const result = await assembleBookStudioProject<{ manifest?: BookProjectManifest }>(projectId, orgId)
      if (!result.ok) {
        setAssembleError(result.error)
        const missing = result.extra?.missing
        setMissingOrders(Array.isArray(missing) ? missing.filter((value): value is number => typeof value === 'number') : undefined)
        setTab('assembly')
        return
      }
      setManifest(result.data?.manifest)
      setTab('assembly')
    } finally {
      setAssembling(false)
    }
  }

  if (loading && !project) {
    return (
      <AppShell contentClassName="bg-[var(--color-pib-bg)]">
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading book project…</p>
      </AppShell>
    )
  }

  if (!project) {
    return (
      <AppShell contentClassName="bg-[var(--color-pib-bg)]">
        <Surface role="alert" className="border-red-200 bg-red-50 text-red-900">
          <strong>Book project not found</strong>
          <p>{notice || 'This project could not be loaded.'}</p>
        </Surface>
      </AppShell>
    )
  }

  const format = project.format ? getBookFormat(project.format) : null

  return (
    <AppShell
      contentClassName="bg-[var(--color-pib-bg)]"
      header={
        <BookProjectHeader
          project={project}
          onOpenInCanvas={openInCanvas}
          openingCanvas={openingCanvas}
          onAssemble={assemble}
          assembling={assembling}
        />
      }
    >
      <div className="space-y-6">
        {notice ? (
          <Surface role="alert" className="border-red-200 bg-red-50 text-red-900">
            <p>{notice}</p>
          </Surface>
        ) : null}

        <PageTabs
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          tabs={[
            { label: 'Content', value: 'content', icon: 'auto_stories' },
            { label: 'Metadata', value: 'metadata', icon: 'edit_note' },
            { label: 'Assembly', value: 'assembly', icon: 'inventory_2' },
          ]}
        />

        {tab === 'content' ? (
          format?.contentUnits === 'chapters' ? (
            <BookProjectChaptersPanel
              chapters={chapters}
              onEditBody={editChapterBody}
              onEditStatus={editChapterStatus}
              onAddChapter={addChapter}
              addingChapter={addingChapter}
            />
          ) : (
            <BookProjectPagesPanel
              pages={pages}
              puzzleKind={format?.puzzleKind}
              onMove={movePage}
              onEdit={editPage}
              onDelete={deletePage}
              onAddPage={addPage}
              onRegeneratePuzzle={regeneratePuzzle}
              onGeneratePuzzles={generatePuzzles}
              addingPage={addingPage}
              regeneratingPageId={regeneratingPageId}
              generatingPuzzles={generatingPuzzles}
            />
          )
        ) : null}

        {tab === 'metadata' ? (
          <BookProjectMetadataPanel metadata={project.metadata ?? {}} saving={savingMetadata} onSave={saveMetadata} />
        ) : null}

        {tab === 'assembly' ? (
          <BookProjectAssemblyPanel
            manifest={manifest}
            assembling={assembling}
            error={assembleError}
            missingOrders={missingOrders}
          />
        ) : null}
      </div>
    </AppShell>
  )
}
