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

const approvalBriefingItem = {
  id: 'approval:approval-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Approval pending',
  summary: 'Status: pending. Comments: Please approve the landing page scope before Theo continues.',
  excerpt: 'Please approve the landing page scope before Theo continues.',
  timeAgo: '5 minutes ago',
  requiresAction: true,
  source: { type: 'approval', id: 'approval-1', url: '/portal/projects/project-1?taskId=approval-task-1' },
  actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    projectId: 'project-1',
    projectName: 'Launch site',
    taskId: 'approval-task-1',
    taskTitle: 'Approve landing page scope',
  },
  metadata: {
    approvalStatus: 'pending',
    approvalType: 'scope',
    requestedBy: 'agent:theo',
    approvalTaskId: 'approval-task-1',
  },
  occurredAt: '2026-05-31T10:00:00.000Z',
}

const secondOrgBriefingItem = {
  id: 'task:item-2',
  orgId: 'org-2',
  priority: 'critical',
  title: 'Blocked launch checklist',
  summary: 'The launch checklist is waiting on client access.',
  excerpt: 'DNS access is still missing.',
  timeAgo: '1 minute ago',
  requiresAction: true,
  source: { type: 'task', id: 'task-2', url: '/portal/projects/project-2?taskId=task-2' },
  actor: { id: 'user:client-2', name: 'Client Two', role: 'client', type: 'user' },
  context: {
    orgId: 'org-2',
    orgName: 'Client Two',
    orgSlug: 'client-two',
    projectId: 'project-2',
    projectName: 'Launch checklist',
    taskId: 'task-2',
    taskTitle: 'Provide DNS access',
  },
  occurredAt: '2026-05-31T10:04:00.000Z',
}

const conversationBriefingItem = {
  id: 'comment:conv-comment-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Client comment from Sam',
  summary: 'Can we confirm the launch date today?',
  excerpt: 'Can we confirm the launch date today?',
  timeAgo: '3 minutes ago',
  requiresAction: true,
  source: { type: 'comment', id: 'conv-comment-1', url: '/admin/communications?convId=conv-1' },
  actor: { id: 'user:sam', name: 'Sam', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    conversationId: 'conv-1',
    conversationTitle: 'Launch planning',
  },
  occurredAt: '2026-05-31T10:02:00.000Z',
}

const socialBriefingItem = {
  id: 'social-post:post-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Social post awaiting client approval',
  summary: 'LinkedIn and Facebook post is ready for review.',
  excerpt: 'Launch offer post for approval.',
  timeAgo: '4 minutes ago',
  requiresAction: true,
  source: { type: 'social-post', id: 'post-1', url: '/portal/social/review/post-1' },
  actor: { id: 'agent:maya', name: 'Maya', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
  },
  metadata: {
    actionStage: 'client',
    status: 'client_review',
    platforms: ['linkedin', 'facebook'],
  },
  occurredAt: '2026-05-31T10:01:00.000Z',
}

const notificationBriefingItem = {
  id: 'notification:notification-1',
  orgId: 'org-1',
  priority: 'client-risk',
  title: 'New enquiry needs follow-up',
  summary: 'A new lead requested a proposal call.',
  excerpt: 'A new lead requested a proposal call.',
  timeAgo: '6 minutes ago',
  requiresAction: true,
  source: { type: 'notification', id: 'notification-1', url: '/portal/contacts?followUp=stale' },
  actor: { id: 'system', name: 'System', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
  },
  metadata: {
    notificationType: 'crm.follow_up_due',
    status: 'unread',
    link: '/portal/contacts?followUp=stale',
  },
  occurredAt: '2026-05-31T09:59:00.000Z',
}

const activityBriefingItem = {
  id: 'activity:activity-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Follow up with Ava Owner',
  summary: 'Follow up with Ava about the retainer approval before Friday.',
  excerpt: 'Confirm approval blockers',
  timeAgo: '7 minutes ago',
  requiresAction: true,
  source: { type: 'activity', id: 'activity-1', url: '/portal/contacts/contact-1' },
  actor: { id: 'user:client-1', name: 'Ava Owner', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    contactId: 'contact-1',
    contactName: 'Ava Owner',
    dealId: 'deal-1',
    dealTitle: 'Website retainer',
  },
  metadata: {
    activityType: 'note',
    contactId: 'contact-1',
    dealId: 'deal-1',
    followUpIntent: 'follow_up',
  },
  occurredAt: '2026-05-31T09:58:00.000Z',
}

const reportBriefingItem = {
  id: 'report:report-1',
  orgId: 'org-1',
  priority: 'review',
  title: 'Report ready to review: May performance report',
  summary: 'Monthly report is rendered and ready to send.',
  excerpt: 'Revenue grew after the launch sprint.',
  timeAgo: '8 minutes ago',
  requiresAction: true,
  source: { type: 'report', id: 'report-1', url: '/reports/public-report-token' },
  actor: { id: 'agent:analyst', name: 'Analyst', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    reportId: 'report-1',
    reportTitle: 'May performance report',
  },
  metadata: {
    reportType: 'monthly',
    status: 'rendered',
    publicToken: 'public-report-token',
  },
  occurredAt: '2026-05-31T09:57:00.000Z',
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
          json: async () => ({ data: [
            { id: 'org-1', name: 'Client One', slug: 'client-one' },
            { id: 'org-2', name: 'Client Two', slug: 'client-two' },
          ] }),
        } as Response
      }
      if (url.startsWith('/api/v1/briefings/feed')) {
        const items = url.includes('orgId=org-2')
          ? [secondOrgBriefingItem]
          : [briefingItem, documentBriefingItem, approvalBriefingItem, conversationBriefingItem, socialBriefingItem, notificationBriefingItem, activityBriefingItem, reportBriefingItem, secondOrgBriefingItem]
        return {
          ok: true,
          json: async () => ({ data: { items, total: items.length, hasMore: false, generatedAt: '2026-05-31T10:05:00.000Z' } }),
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
      if (url === '/api/v1/projects/project-1/tasks/approval-task-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'approval-task-1' } }),
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
      if (url === '/api/v1/conversations/conv-1/messages') {
        return {
          ok: true,
          json: async () => ({ data: { message: { id: 'message-1' } } }),
        } as Response
      }
      if (url === '/api/v1/social/posts/post-1/client-approve') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'post-1', status: 'approved' } }),
        } as Response
      }
      if (url === '/api/v1/social/posts/post-1/client-reject') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'post-1', status: 'regenerating' } }),
        } as Response
      }
      if (url === '/api/v1/notifications/notification-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'notification-1' } }),
        } as Response
      }
      if (url === '/api/v1/crm/activities') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'activity-note-1' } }),
        } as Response
      }
      if (url === '/api/v1/reports/report-1/send') {
        return {
          ok: true,
          json: async () => ({ ok: true, link: '/reports/public-report-token', recipients: ['client@example.test'] }),
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
    expect(screen.getByRole('button', { name: /filter to client two workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/projects/project-1?taskId=task-1')
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send back to agent/i })).toBeInTheDocument()
  })

  it('lets users switch the live desk to a noisy organisation from workspace pulse', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /filter to client two workspace/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/briefings/feed?orgId=org-2'))
    })
    expect((await screen.findAllByText('Blocked launch checklist')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Theo completed work - review required')).not.toBeInTheDocument()
    expect(screen.getAllByText('1 live cards').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /all workspaces/i })).toBeInTheDocument()
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
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve document/i })).not.toBeDisabled()
    })
  })

  it('lets users approve and reject approval gate cards from the desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Approval pending/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/projects/project-1?taskId=approval-task-1')
    expect(screen.getByRole('button', { name: /approve approval/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject approval/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /approve approval/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks/approval-task-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          reviewStatus: 'approved',
          approvalStatus: 'approved',
          columnId: 'done',
          agentStatus: 'done',
        }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject approval/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /reject approval/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks/approval-task-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          reviewStatus: 'changes-requested',
          approvalStatus: 'rejected',
          agentStatus: 'pending',
          columnId: 'todo',
        }),
      }))
    })
  })

  it('deep-links and replies to conversation comment cards from the desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Client comment from Sam/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/conversations?convId=conv-1')
    expect(screen.getByText('Launch planning (conv-1)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Inline conversation reply'), { target: { value: 'Yes, launch is confirmed for Friday.' } })
    fireEvent.click(screen.getByRole('button', { name: /post reply to conversation/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Yes, launch is confirmed for Friday.' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Inline conversation reply')).toHaveValue('')
    })
  })

  it('approves and rejects social approval cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Social post awaiting client approval/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/social/review/post-1')
    expect(screen.getByRole('button', { name: /approve social post/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request social changes/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /approve social post/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts/post-1/client-approve', expect.objectContaining({
        method: 'POST',
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve social post/i })).not.toBeDisabled()
    })
    fireEvent.change(screen.getByLabelText('Social change request'), { target: { value: 'Please make the CTA more direct.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /request social changes/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /request social changes/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts/post-1/client-reject', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Please make the CTA more direct.' }),
      }))
    })
  })

  it('marks notification cards read or archived from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /New enquiry needs follow-up/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/contacts?followUp=stale')
    expect(screen.getByRole('button', { name: /mark notification read/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archive notification/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark notification read/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/notifications/notification-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'read' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /archive notification/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /archive notification/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/notifications/notification-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      }))
    })
  })

  it('logs CRM follow-up notes from activity cards and keeps source links exact', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Follow up with Ava Owner/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/contacts/contact-1')
    expect(screen.getByText('Ava Owner (contact-1)')).toBeInTheDocument()
    expect(screen.getByText('Website retainer (deal-1)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Follow-up note'), { target: { value: 'Called Ava; approval is waiting on finance.' } })
    fireEvent.click(screen.getByRole('button', { name: /log follow-up note/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/activities', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          contactId: 'contact-1',
          dealId: 'deal-1',
          type: 'note',
          summary: 'Called Ava; approval is waiting on finance.',
          metadata: {
            sourceBriefingId: 'activity:activity-1',
            sourceActivityId: 'activity-1',
            source: 'briefings-control-desk',
          },
        }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Follow-up note')).toHaveValue('')
    })
  })

  it('opens and sends rendered report cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Report ready to review: May performance report/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/reports/public-report-token')
    expect(screen.getByText('May performance report (report-1)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Report recipients'), { target: { value: 'client@example.test, ops@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: /send report/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/reports/report-1/send', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: ['client@example.test', 'ops@example.test'] }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Report recipients')).toHaveValue('')
    })
  })
})
