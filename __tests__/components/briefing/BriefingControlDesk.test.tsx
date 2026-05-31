import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BriefingControlDesk } from '@/components/briefing/BriefingControlDesk'

const briefingItem = {
  id: 'task:item-1',
  orgId: 'org-1',
  priority: 'review',
  title: 'Theo completed work - review required',
  summary: 'Result: Updated the homepage.',
  excerpt: 'Updated the homepage and left evidence.',
  timeAgo: '2 minutes ago',
  requiresAction: true,
  source: { type: 'agent-output', id: 'item-1', url: 'https://partnersinbiz.online/admin/projects/project-1?taskId=task-1' },
  actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    projectId: 'project-1',
    projectName: 'Launch site',
    taskId: 'task-1',
    taskTitle: 'Update homepage',
  },
  occurredAt: '2026-05-31T10:00:00.000Z',
}

const documentBriefingItem = {
  id: 'client-document:doc-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Document pending approval: Growth plan',
  summary: 'Type: proposal. Status: published. Approval: pending',
  excerpt: 'Review the proposed growth plan.',
  timeAgo: '5 minutes ago',
  requiresAction: true,
  source: { type: 'client-document', id: 'doc-1', url: '/portal/documents/doc-1' },
  actor: { id: 'user:admin-1', name: 'Peet', role: 'admin', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    documentId: 'doc-1',
    documentTitle: 'Growth plan',
  },
  occurredAt: '2026-05-31T10:00:00.000Z',
}

describe('BriefingControlDesk', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-05-31T10:05:00.000Z'))
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'org-1', name: 'Client One', slug: 'client-one' }] }),
        } as Response
      }
      if (url.startsWith('/api/v1/briefings/feed')) {
        return {
          ok: true,
          json: async () => ({ data: { items: [briefingItem, documentBriefingItem], total: 2, hasMore: false, generatedAt: '2026-05-31T10:05:00.000Z' } }),
        } as Response
      }
      if (url === '/api/v1/briefings/items/task%3Aitem-1/state') {
        return {
          ok: true,
          json: async () => ({ data: { itemId: 'task:item-1', status: 'handled' } }),
        } as Response
      }
      if (url === '/api/v1/projects/project-1/tasks/task-1/comments') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'comment-1' } }),
        } as Response
      }
      if (url === '/api/v1/client-documents/doc-1/comments') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'document-comment-1' } }),
        } as Response
      }
      if (url === '/api/v1/client-documents/doc-1/approve') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'approval-1' } }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ data: { id: 'ok' } }),
      } as Response
    }) as jest.Mock
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('renders a live multi-org control desk with source-aware task actions', async () => {
    render(<BriefingControlDesk mode="portal" />)

    expect(await screen.findByText('Briefings control desk')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /live on/i })).toBeInTheDocument()
    expect((await screen.findAllByText('Theo completed work - review required')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Client One').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/projects/project-1?taskId=task-1')
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send back to agent/i })).toBeInTheDocument()
  })

  it('posts inline replies and removes handled cards from the visible desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    expect((await screen.findAllByText('Theo completed work - review required')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Inline task reply'), { target: { value: 'Approved. Please ship it.' } })
    fireEvent.click(screen.getByRole('button', { name: /post reply to task/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks/task-1/comments', expect.objectContaining({
        method: 'POST',
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /handled/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /handled/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/briefings/items/task%3Aitem-1/state', expect.objectContaining({
        method: 'POST',
      }))
    })
    await waitFor(() => {
      expect(screen.queryAllByText('Theo completed work - review required')).toHaveLength(0)
    })
  })

  it('lets users comment on and approve document approval cards from the desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Document pending approval: Growth plan/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/documents/doc-1')
    expect(screen.getByRole('button', { name: /approve document/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Inline document reply'), { target: { value: 'Please update the scope before approval.' } })
    fireEvent.click(screen.getByRole('button', { name: /post reply to document/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/client-documents/doc-1/comments', expect.objectContaining({
        method: 'POST',
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve document/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /approve document/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/client-documents/doc-1/approve', expect.objectContaining({
        method: 'POST',
      }))
    })
  })
})
