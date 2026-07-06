import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

function headerRequestDraftButton(): HTMLElement {
  const header = document.querySelector('[data-slot="app-shell-header"]') as HTMLElement
  return within(header).getByRole('button', { name: /Request AI draft/i })
}
import { BookProjectWorkspace } from '@/components/book-studio/BookProjectWorkspace'
import type { BookStudioCapabilities } from '@/lib/book-studio/capabilities'
import * as bookStudioClient from '@/lib/book-studio/client'

const portalCapabilities: BookStudioCapabilities = {
  canView: true,
  canCreate: true,
  canEdit: true,
  canEvidenceRights: true,
  canApprovalGates: false,
  canPublishingPackets: false,
  canArchiveDelete: false,
  isOperator: false,
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

const colouringProject = {
  id: 'project-1',
  orgId: 'org-1',
  title: 'Ocean Friends Colouring Book',
  status: 'draft',
  stage: 'brief',
  format: 'colouring',
  trim: { presetId: '8.5x11' },
  metadata: { title: 'Ocean Friends', authorName: 'Iris Vance' },
}

const puzzleProject = {
  id: 'project-puzzle',
  orgId: 'org-1',
  title: 'Word Search Fun',
  status: 'draft',
  format: 'puzzle_word_search',
}

const storyProject = {
  id: 'project-story',
  orgId: 'org-1',
  title: 'The Proof Chronicles',
  status: 'draft',
  format: 'story',
  creativeCanvasId: 'canvas-9',
}

const pagesForColouring = [
  { id: 'page-1', orgId: 'org-1', projectId: 'project-1', kind: 'colouring', order: 0, title: 'Whale', status: 'draft' },
  { id: 'page-2', orgId: 'org-1', projectId: 'project-1', kind: 'colouring', order: 1, title: 'Octopus', status: 'draft' },
]

const crosswordProject = {
  id: 'project-crossword',
  orgId: 'org-1',
  title: 'Crossword Capers',
  status: 'draft',
  format: 'puzzle_crossword',
}

const crosswordPuzzlePage = {
  id: 'page-crossword-1',
  orgId: 'org-1',
  projectId: 'project-crossword',
  kind: 'puzzle',
  order: 3,
  title: 'Crossword — medium #1',
  status: 'generated',
  puzzle: { kind: 'crossword', seed: 42, difficulty: 'medium', params: { entries: [{ word: 'OCEAN', clue: 'Large body of salt water' }] } },
}

const chaptersForStory = [
  { id: 'chapter-1', orgId: 'org-1', projectId: 'project-story', title: 'Chapter One', order: 0, wordCount: 120, status: 'draft' },
]

type FetchOverrides = {
  projects?: unknown[]
  pages?: unknown[]
  chapters?: unknown[]
  onGeneratePuzzles?: (body: Record<string, unknown>) => void
  onOpenInCanvas?: () => void
  assembleResponse?: { ok: boolean; body: unknown; status?: number }
}

function installFetch(overrides: FetchOverrides = {}) {
  const projects = overrides.projects ?? [colouringProject]
  const pages = overrides.pages ?? pagesForColouring
  const chapters = overrides.chapters ?? []

  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url.includes('/pages/generate-puzzles') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      overrides.onGeneratePuzzles?.(body)
      return jsonResponse({ success: true, data: { pages: [] } }, true, 201)
    }
    if (url.includes('/open-in-canvas') && method === 'POST') {
      overrides.onOpenInCanvas?.()
      return jsonResponse({ success: true, data: { canvasId: 'canvas-9', created: true } }, true, 201)
    }
    if (url.includes('/assemble') && method === 'POST') {
      const response = overrides.assembleResponse ?? {
        ok: true,
        body: {
          success: true,
          data: {
            manifest: {
              status: 'generated',
              version: 3,
              qaStatus: 'pending_review',
              generatedAt: '2026-07-01T00:00:00Z',
              files: [
                { role: 'interior_pdf', label: 'Interior PDF', href: 'https://cdn.example/interior.pdf', checksum: 'abcdef123456789', bytes: 204800, pageCount: 24 },
                { role: 'cover_pdf', label: 'Cover PDF', href: 'https://cdn.example/cover.pdf', checksum: 'fedcba987654321', bytes: 51200 },
              ],
            },
          },
        },
      }
      return jsonResponse(response.body, response.ok, response.status ?? (response.ok ? 200 : 422))
    }
    if (url.includes('/book-studio/projects') && method === 'GET') {
      return jsonResponse({ success: true, data: { resource: 'projects', records: projects } })
    }
    if (url.includes('/book-studio/chapters') && method === 'GET') {
      return jsonResponse({ success: true, data: { resource: 'chapters', records: chapters } })
    }
    if (url.includes('/book-studio/pages') && method === 'GET') {
      return jsonResponse({ success: true, data: { resource: 'pages', records: pages } })
    }
    if (url.includes('/book-studio/pages') && method === 'POST') {
      return jsonResponse({ success: true, data: { id: 'page-new', resource: 'pages' } }, true, 201)
    }
    if (url.includes('/book-studio/chapters') && method === 'POST') {
      return jsonResponse({ success: true, data: { id: 'chapter-new', resource: 'chapters' } }, true, 201)
    }
    if (method === 'PATCH') {
      return jsonResponse({ success: true, data: { updated: true } })
    }
    return jsonResponse({ success: true, data: {} })
  })
  global.fetch = fetchMock as jest.Mock
  return fetchMock
}

describe('BookProjectWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders header and pages for a colouring project', async () => {
    installFetch()
    render(<BookProjectWorkspace orgId="org-1" projectId="project-1" />)

    expect(await screen.findByText('Ocean Friends Colouring Book')).toBeInTheDocument()
    expect(screen.getByText('Colouring Book')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Book pages' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Whale')).toBeInTheDocument()
  })

  it('shows the generate puzzles button only for puzzle-capable formats', async () => {
    installFetch({ projects: [puzzleProject], pages: [] })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-puzzle" />)

    await screen.findByText('Word Search Fun')
    expect(screen.getByRole('button', { name: 'Generate puzzles' })).toBeInTheDocument()
  })

  it('hides the generate puzzles button for a colouring project', async () => {
    installFetch()
    render(<BookProjectWorkspace orgId="org-1" projectId="project-1" />)

    await screen.findByText('Ocean Friends Colouring Book')
    expect(screen.queryByRole('button', { name: 'Generate puzzles' })).not.toBeInTheDocument()
  })

  it('posts the correct payload from the puzzle dialog', async () => {
    let posted: Record<string, unknown> | undefined
    installFetch({ projects: [puzzleProject], pages: [], onGeneratePuzzles: (body) => { posted = body } })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-puzzle" />)

    await screen.findByText('Word Search Fun')
    fireEvent.click(screen.getByRole('button', { name: 'Generate puzzles' }))

    const dialog = await screen.findByRole('dialog', { name: 'Generate puzzles' })
    const countInput = within(dialog).getByLabelText('Count')
    fireEvent.change(countInput, { target: { value: '10' } })
    const wordsInput = within(dialog).getByLabelText(/Words/)
    fireEvent.change(wordsInput, { target: { value: 'OCEAN\nWHALE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate puzzles' }))

    await waitFor(() => expect(posted).toBeDefined())
    expect(posted).toMatchObject({
      kind: 'word_search',
      count: 10,
      difficulty: 'medium',
      params: { words: ['OCEAN', 'WHALE'] },
    })
  })

  it('surfaces a 400 error inline from the puzzle dialog', async () => {
    installFetch({
      projects: [puzzleProject],
      pages: [],
    })
    // override the generate-puzzles handler to fail
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/pages/generate-puzzles')) {
        return jsonResponse({ success: false, error: 'count must be an integer between 1 and 100' }, false, 400)
      }
      if (url.includes('/book-studio/projects') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'projects', records: [puzzleProject] } })
      }
      if (url.includes('/book-studio/chapters') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'chapters', records: [] } })
      }
      if (url.includes('/book-studio/pages') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'pages', records: [] } })
      }
      return jsonResponse({ success: true, data: {} })
    }) as jest.Mock

    render(<BookProjectWorkspace orgId="org-1" projectId="project-puzzle" />)
    await screen.findByText('Word Search Fun')
    fireEvent.click(screen.getByRole('button', { name: 'Generate puzzles' }))
    const dialog = await screen.findByRole('dialog', { name: 'Generate puzzles' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate puzzles' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('count must be an integer between 1 and 100')
  })

  it('renders chapters mode for a story format project', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-story" />)

    await screen.findByText('The Proof Chronicles')
    const list = await screen.findByRole('list', { name: 'Book chapters' })
    expect(within(list).getByText('Chapter One')).toBeInTheDocument()
    expect(within(list).getByText('120 words')).toBeInTheDocument()
  })

  it('does not render a pages list for a chapters-based format', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-story" />)

    await screen.findByText('The Proof Chronicles')
    expect(screen.queryByRole('list', { name: 'Book pages' })).not.toBeInTheDocument()
  })

  it('posts to open-in-canvas and navigates to the canvas', async () => {
    let opened = false
    installFetch({ projects: [storyProject], onOpenInCanvas: () => { opened = true } })
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null)
    render(<BookProjectWorkspace orgId="org-1" projectId="project-story" />)

    await screen.findByText('The Proof Chronicles')
    fireEvent.click(screen.getByRole('button', { name: 'Open in canvas' }))

    await waitFor(() => expect(opened).toBe(true))
    expect(openSpy).toHaveBeenCalledWith('/admin/creative-canvas?canvas=canvas-9', '_self')
    openSpy.mockRestore()
  })

  it('renders manifest file rows with checksum snippet and download hrefs on assemble success', async () => {
    installFetch({ projects: [colouringProject] })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-1" />)

    await screen.findByText('Ocean Friends Colouring Book')
    fireEvent.click(screen.getByRole('button', { name: 'Assemble book' }))

    const list = await screen.findByRole('list', { name: 'Manifest files' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText(/abcdef123456/)).toBeInTheDocument()
    const downloadLink = within(items[0]).getByRole('link', { name: 'Download' })
    expect(downloadLink).toHaveAttribute('href', 'https://cdn.example/interior.pdf')
    expect(downloadLink).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Version 3')).toBeInTheDocument()
  })

  it('renders missing page orders inline on a 422 assemble response', async () => {
    installFetch({
      projects: [colouringProject],
      assembleResponse: {
        ok: false,
        status: 422,
        body: { success: false, error: 'pages are missing required image assets', missing: [0, 2] },
      },
    })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-1" />)

    await screen.findByText('Ocean Friends Colouring Book')
    fireEvent.click(screen.getByRole('button', { name: 'Assemble book' }))

    await screen.findByText('pages are missing required image assets')
    expect(screen.getByText(/Missing page orders: 0, 2/)).toBeInTheDocument()
  })

  it('parses crossword dialog entries into {word, clue}[] before posting', async () => {
    let posted: Record<string, unknown> | undefined
    installFetch({ projects: [crosswordProject], pages: [], onGeneratePuzzles: (body) => { posted = body } })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-crossword" />)

    await screen.findByText('Crossword Capers')
    fireEvent.click(screen.getByRole('button', { name: 'Generate puzzles' }))

    const dialog = await screen.findByRole('dialog', { name: 'Generate puzzles' })
    const entriesInput = within(dialog).getByLabelText(/Entries/)
    fireEvent.change(entriesInput, {
      target: { value: 'OCEAN:Large body of salt water\nWHALE:Big marine mammal\nnoseparatorline\n:missingword\nEMPTYCLUE:' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate puzzles' }))

    await waitFor(() => expect(posted).toBeDefined())
    expect(posted).toMatchObject({
      kind: 'crossword',
      params: {
        entries: [
          { word: 'OCEAN', clue: 'Large body of salt water' },
          { word: 'WHALE', clue: 'Big marine mammal' },
        ],
      },
    })
  })

  it('shows an inline validation message when no crossword entries parse', async () => {
    installFetch({ projects: [crosswordProject], pages: [] })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-crossword" />)

    await screen.findByText('Crossword Capers')
    fireEvent.click(screen.getByRole('button', { name: 'Generate puzzles' }))

    const dialog = await screen.findByRole('dialog', { name: 'Generate puzzles' })
    const entriesInput = within(dialog).getByLabelText(/Entries/)
    fireEvent.change(entriesInput, { target: { value: 'no colon here\nanother bad line' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate puzzles' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter at least one valid "word:clue" line')
  })

  it('regenerate calls generate before delete, passes stored params + preserved startOrder', async () => {
    const callOrder: string[] = []
    let generatePayload: Record<string, unknown> | undefined
    let deleteBody: Record<string, unknown> | undefined

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/pages/generate-puzzles') && method === 'POST') {
        callOrder.push('generate')
        generatePayload = JSON.parse(String(init?.body ?? '{}'))
        return jsonResponse({ success: true, data: { pages: [{ id: 'page-crossword-2' }] } }, true, 201)
      }
      if (url.includes('/book-studio/pages/') && method === 'PATCH') {
        callOrder.push('delete')
        deleteBody = JSON.parse(String(init?.body ?? '{}'))
        return jsonResponse({ success: true, data: { updated: true } })
      }
      if (url.includes('/book-studio/projects') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'projects', records: [crosswordProject] } })
      }
      if (url.includes('/book-studio/chapters') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'chapters', records: [] } })
      }
      if (url.includes('/book-studio/pages') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'pages', records: [crosswordPuzzlePage] } })
      }
      return jsonResponse({ success: true, data: {} })
    }) as jest.Mock

    render(<BookProjectWorkspace orgId="org-1" projectId="project-crossword" />)
    await screen.findByText('Crossword Capers')

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => expect(callOrder).toEqual(['generate', 'delete']))
    expect(generatePayload).toMatchObject({
      kind: 'crossword',
      count: 1,
      difficulty: 'medium',
      startOrder: 3,
      params: { entries: [{ word: 'OCEAN', clue: 'Large body of salt water' }] },
    })
    expect(deleteBody).toMatchObject({ deleted: true })
  })

  it('leaves the page un-deleted and shows an error when regenerate generation fails', async () => {
    let deleteCalled = false

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/pages/generate-puzzles') && method === 'POST') {
        return jsonResponse({ success: false, error: 'Crossword: no valid entries after sanitisation' }, false, 400)
      }
      if (url.includes('/book-studio/pages/') && method === 'PATCH') {
        deleteCalled = true
        return jsonResponse({ success: true, data: { updated: true } })
      }
      if (url.includes('/book-studio/projects') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'projects', records: [crosswordProject] } })
      }
      if (url.includes('/book-studio/chapters') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'chapters', records: [] } })
      }
      if (url.includes('/book-studio/pages') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'pages', records: [crosswordPuzzlePage] } })
      }
      return jsonResponse({ success: true, data: {} })
    }) as jest.Mock

    render(<BookProjectWorkspace orgId="org-1" projectId="project-crossword" />)
    await screen.findByText('Crossword Capers')

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    await screen.findByText('Crossword: no valid entries after sanitisation')
    expect(deleteCalled).toBe(false)
  })

  it('surfaces an error and still refetches when one of the movePage order PATCHes fails', async () => {
    let patchCount = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/book-studio/pages/') && method === 'PATCH') {
        patchCount += 1
        if (patchCount === 2) {
          return jsonResponse({ success: false, error: 'order update rejected' }, false, 500)
        }
        return jsonResponse({ success: true, data: { updated: true } })
      }
      if (url.includes('/book-studio/projects') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'projects', records: [colouringProject] } })
      }
      if (url.includes('/book-studio/chapters') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'chapters', records: [] } })
      }
      if (url.includes('/book-studio/pages') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'pages', records: pagesForColouring } })
      }
      return jsonResponse({ success: true, data: {} })
    }) as jest.Mock

    render(<BookProjectWorkspace orgId="org-1" projectId="project-1" />)
    await screen.findByText('Ocean Friends Colouring Book')

    fireEvent.click(screen.getByRole('button', { name: 'Move Whale down' }))

    await screen.findByText('order update rejected')
    expect(patchCount).toBe(2)
  })

  it('portal surface hides operator canvas/assemble actions and shows a request-draft button', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    render(
      <BookProjectWorkspace
        orgId="org-1"
        projectId="project-story"
        surface="portal"
        capabilities={portalCapabilities}
      />,
    )

    await screen.findByText('The Proof Chronicles')
    expect(screen.queryByRole('button', { name: /Open in canvas/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assemble/i })).not.toBeInTheDocument()
    expect(headerRequestDraftButton()).toBeInTheDocument()
  })

  it('clicking "Request AI draft" calls requestBookStudioDraft and shows a success notice', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    const requestSpy = jest
      .spyOn(bookStudioClient, 'requestBookStudioDraft')
      .mockResolvedValue({ ok: true, data: { taskId: 'task-1' } })

    render(
      <BookProjectWorkspace
        orgId="org-1"
        projectId="project-story"
        surface="portal"
        capabilities={portalCapabilities}
      />,
    )

    await screen.findByText('The Proof Chronicles')
    fireEvent.click(headerRequestDraftButton())

    await screen.findByText('AI draft request sent to your PiB team.')
    expect(requestSpy).toHaveBeenCalledWith('project-story', { unitType: 'cover' })
    requestSpy.mockRestore()
  })

  it('shows the returned error notice when requestBookStudioDraft 409s', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    const requestSpy = jest.spyOn(bookStudioClient, 'requestBookStudioDraft').mockResolvedValue({
      ok: false,
      error: 'An AI draft request for this item is already open',
      status: 409,
    })

    render(
      <BookProjectWorkspace
        orgId="org-1"
        projectId="project-story"
        surface="portal"
        capabilities={portalCapabilities}
      />,
    )

    await screen.findByText('The Proof Chronicles')
    fireEvent.click(headerRequestDraftButton())

    await screen.findByText('An AI draft request for this item is already open')
    requestSpy.mockRestore()
  })

  it('admin-surface render fetches the full admin projects prefix, pinning URL-per-surface routing', async () => {
    const fetchMock = installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    render(<BookProjectWorkspace orgId="org-1" projectId="project-story" />)

    await screen.findByText('The Proof Chronicles')
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(calledUrls.some((url) => url.includes('/api/v1/book-studio/projects?'))).toBe(true)
    expect(calledUrls.some((url) => url.includes('/api/v1/portal/book-studio/projects'))).toBe(false)
  })

  it('portal caps with canPublishingPackets:false hide the Assembly tab', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    render(
      <BookProjectWorkspace
        orgId="org-1"
        projectId="project-story"
        surface="portal"
        capabilities={{ ...portalCapabilities, canPublishingPackets: false }}
      />,
    )

    await screen.findByText('The Proof Chronicles')
    expect(screen.queryByRole('tab', { name: 'Assembly' })).not.toBeInTheDocument()
    expect(screen.queryByText('Assembly')).not.toBeInTheDocument()
  })

  it('portal caps hide pages-panel operator tools (generate/regenerate puzzles) for the crossword puzzle format', async () => {
    installFetch({ projects: [crosswordProject], pages: [crosswordPuzzlePage] })
    render(
      <BookProjectWorkspace
        orgId="org-1"
        projectId="project-crossword"
        surface="portal"
        capabilities={{ ...portalCapabilities, isOperator: false }}
      />,
    )

    await screen.findByText('Crossword Capers')
    expect(screen.queryByRole('button', { name: 'Generate puzzles' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument()
  })

  it('portal surface with canEdit:false hides the add-chapter affordance', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    render(
      <BookProjectWorkspace
        orgId="org-1"
        projectId="project-story"
        surface="portal"
        capabilities={{ ...portalCapabilities, canEdit: false }}
      />,
    )

    await screen.findByText('The Proof Chronicles')
    expect(screen.queryByRole('button', { name: /Add chapter/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('New chapter title')).not.toBeInTheDocument()
  })

  it('portal caps with canEdit:false hide the "Request AI draft" button', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    render(
      <BookProjectWorkspace
        orgId="org-1"
        projectId="project-story"
        surface="portal"
        capabilities={{ ...portalCapabilities, canEdit: false }}
      />,
    )

    await screen.findByText('The Proof Chronicles')
    expect(screen.queryByRole('button', { name: /Request AI draft/i })).not.toBeInTheDocument()
  })

  it('portal surface with canApprovalGates:false excludes "approved" from status options', async () => {
    installFetch({ projects: [storyProject], chapters: chaptersForStory, pages: [] })
    render(
      <BookProjectWorkspace
        orgId="org-1"
        projectId="project-story"
        surface="portal"
        capabilities={portalCapabilities}
      />,
    )

    await screen.findByText('The Proof Chronicles')
    const statusSelect = (await screen.findByLabelText('Status')) as HTMLSelectElement
    const optionValues = Array.from(statusSelect.options).map((option) => option.value)
    expect(optionValues).not.toContain('approved')
  })
})
