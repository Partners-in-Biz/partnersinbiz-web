import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ResearchDetailClient } from '@/components/research/ResearchDetailClient'
import type { ContextReference } from '@/lib/context-references/types'

const contextRef: ContextReference = {
  type: 'project',
  id: 'project-1',
  orgId: 'org-1',
  label: 'Launch Project',
  origin: 'mention',
  href: '/admin/projects/project-1',
  summary: 'status: active',
}

const researchItem = {
  id: 'research-1',
  orgId: 'org-1',
  title: 'Market Scan',
  kind: 'competitor_scan',
  status: 'draft',
  visibility: 'internal',
  summary: 'Market background.',
  notesMarkdown: '',
  findings: [],
  recommendations: [],
  linked: { documentIds: [] },
  obsidian: { exported: false },
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/v1/research/research-1') {
      return { ok: true, json: async () => ({ success: true, data: researchItem }) } as Response
    }
    if (url === '/api/v1/research/research-1/sources') {
      return { ok: true, json: async () => ({ success: true, data: [] }) } as Response
    }
    if (url.startsWith('/api/v1/comments?')) {
      return { ok: true, json: async () => ({ success: true, data: [] }) } as Response
    }
    if (url.startsWith('/api/v1/context-references/search')) {
      return { ok: true, json: async () => ({ success: true, data: { refs: [contextRef] } }) } as Response
    }
    if (url === '/api/v1/comments' && init?.method === 'POST') {
      return { ok: true, json: async () => ({ success: true, data: { id: 'comment-1' } }) } as Response
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
})

describe('ResearchDetailClient context references', () => {
  it('attaches selected context refs to research comments', async () => {
    render(<ResearchDetailClient id="research-1" mode="admin" basePath="/admin/research" />)

    expect(await screen.findByText('Market Scan')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Comment on this research'), {
      target: { value: 'Use this launch project as evidence.' },
    })
    fireEvent.change(screen.getByLabelText('Add research comment context reference'), {
      target: { value: '@projects:launch' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Attach Launch Project' }))
    fireEvent.click(screen.getByRole('button', { name: /Post Comment/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/comments',
      expect.objectContaining({ method: 'POST' }),
    ))
    const createCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) => (
      url === '/api/v1/comments' && init?.method === 'POST'
    ))
    expect(JSON.parse(createCall[1].body)).toEqual(expect.objectContaining({
      contextRefs: [expect.objectContaining({ type: 'project', id: 'project-1', label: 'Launch Project' })],
    }))
  })
})
