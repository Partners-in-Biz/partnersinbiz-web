import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { BookSeriesWorkspace } from '@/components/book-studio/BookSeriesWorkspace'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response
}

const seriesRecord = {
  id: 'series-1',
  orgId: 'org-1',
  name: 'The Proof Chronicles',
  volumeOrder: ['project-2', 'project-1'],
  sharedMetadata: { authorName: 'Iris Vance', imprint: 'Lumen Press', keywords: ['growth'], categories: ['business'] },
  sharedStylePrompt: 'Warm, confident, evidence-led narration.',
}

const projectRecords = [
  {
    id: 'project-1',
    orgId: 'org-1',
    seriesId: 'series-1',
    title: 'The Proof Chronicles — Volume 1',
    status: 'approved',
    format: 'story',
    trim: { presetId: '6x9' },
    stylePrompt: 'Warm, confident, evidence-led narration.',
    seriesVolumeNumber: 1,
    packageManifest: { version: 3, files: [{ href: 'https://cdn.example/a.pdf' }, { href: 'https://cdn.example/b.epub' }] },
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'project-2',
    orgId: 'org-1',
    seriesId: 'series-1',
    title: 'The Proof Chronicles — Volume 2',
    status: 'draft',
    format: 'nonfiction',
    seriesVolumeNumber: 2,
    createdAt: '2026-02-01T00:00:00Z',
  },
  {
    id: 'project-other-series',
    orgId: 'org-1',
    seriesId: 'series-other',
    title: 'Not in this series',
    status: 'draft',
    seriesVolumeNumber: 1,
    createdAt: '2026-01-15T00:00:00Z',
  },
]

function installFetch(overrides: { onPatchSeries?: (body: Record<string, unknown>) => void; onPostProject?: (body: Record<string, unknown>) => void } = {}) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url.includes('/api/v1/book-studio/series/series-1') && method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      overrides.onPatchSeries?.(body)
      return jsonResponse({ success: true, data: { id: 'series-1', resource: 'series', updated: true } })
    }
    if (url.includes('/api/v1/book-studio/series') && method === 'GET') {
      return jsonResponse({ success: true, data: { resource: 'series', records: [seriesRecord] } })
    }
    if (url.includes('/api/v1/book-studio/projects') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      overrides.onPostProject?.(body)
      return jsonResponse({ success: true, data: { id: 'project-3', resource: 'projects' } }, true)
    }
    if (url.includes('/api/v1/book-studio/projects') && method === 'GET') {
      return jsonResponse({ success: true, data: { resource: 'projects', records: projectRecords } })
    }
    return jsonResponse({ success: true, data: {} })
  })
  global.fetch = fetchMock as jest.Mock
  return fetchMock
}

describe('BookSeriesWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders volumes in volumeOrder order', async () => {
    installFetch()
    render(<BookSeriesWorkspace orgId="org-1" seriesId="series-1" />)

    const list = await screen.findByRole('list', { name: 'Series volumes' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('The Proof Chronicles — Volume 2')).toBeInTheDocument()
    expect(within(items[1]).getByText('The Proof Chronicles — Volume 1')).toBeInTheDocument()
    expect(within(items[1]).getByText(/Files v3/)).toBeInTheDocument()
  })

  it('sends a PATCH with the reordered array on reorder click', async () => {
    let patchedBody: Record<string, unknown> | undefined
    installFetch({ onPatchSeries: (body) => { patchedBody = body } })
    render(<BookSeriesWorkspace orgId="org-1" seriesId="series-1" />)

    await screen.findByRole('list', { name: 'Series volumes' })
    const moveDownButton = screen.getByRole('button', { name: /move the proof chronicles — volume 2 down/i })
    fireEvent.click(moveDownButton)

    await waitFor(() => expect(patchedBody).toBeDefined())
    expect(patchedBody?.volumeOrder).toEqual(['project-1', 'project-2'])
  })

  it('creates the next volume inheriting format/stylePrompt with the correct volume number and appends to volumeOrder', async () => {
    let createdBody: Record<string, unknown> | undefined
    let patchedBody: Record<string, unknown> | undefined
    installFetch({
      onPostProject: (body) => { createdBody = body },
      onPatchSeries: (body) => { patchedBody = body },
    })
    render(<BookSeriesWorkspace orgId="org-1" seriesId="series-1" />)

    await screen.findByRole('list', { name: 'Series volumes' })
    fireEvent.click(screen.getByRole('button', { name: /create next volume/i }))

    await waitFor(() => expect(createdBody).toBeDefined())
    expect(createdBody).toMatchObject({
      orgId: 'org-1',
      seriesId: 'series-1',
      seriesVolumeNumber: 3,
      title: 'The Proof Chronicles — Volume 3',
      format: 'story',
      trim: { presetId: '6x9' },
      stylePrompt: 'Warm, confident, evidence-led narration.',
    })

    await waitFor(() => expect(patchedBody).toBeDefined())
    expect(patchedBody?.volumeOrder).toEqual(['project-2', 'project-1', 'project-3'])
  })

  it('disables/hides the header create-next-volume action when the series failed to load', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/api/v1/book-studio/series') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'series', records: [] } })
      }
      if (url.includes('/api/v1/book-studio/projects') && method === 'GET') {
        return jsonResponse({ success: true, data: { resource: 'projects', records: [] } })
      }
      return jsonResponse({ success: true, data: {} })
    })
    global.fetch = fetchMock as jest.Mock

    render(<BookSeriesWorkspace orgId="org-1" seriesId="series-missing" />)

    await screen.findByText('Series not found')

    const headerCreateButton = screen.queryByRole('button', { name: /create next volume/i })
    if (headerCreateButton) {
      expect(headerCreateButton).toBeDisabled()
    } else {
      expect(headerCreateButton).not.toBeInTheDocument()
    }
  })
})
