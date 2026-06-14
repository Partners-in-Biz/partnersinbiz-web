import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MissionControlDashboard from '@/app/(admin)/admin/dashboard/page'

jest.mock('next/link', () => {
  return function MockLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return <a href={href} {...props}>{children}</a>
  }
})

describe('Mission control dashboard', () => {
  beforeEach(() => {
    jest.useRealTimers()
  })

  it('renders organisation cards, health strip, task pulse, approval radar, and today timeline from live API data', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [
            { id: 'org-1', name: 'Acme Co', slug: 'acme', status: 'active', type: 'client', memberCount: 3 },
          ] }),
        } as Response)
      }
      if (url === '/api/v1/admin/agent-tasks?orgId=pib-platform-owner&assigneeAgentId=theo') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { cards: [
            { id: 'task-1', orgId: 'org-1', title: 'Build campaign', assigneeAgentId: 'theo', agentStatus: 'in-progress', priority: 'urgent', href: '/admin/org/acme/projects/proj?task=task-1', updatedAt: new Date().toISOString() },
            { id: 'task-2', orgId: 'org-1', title: 'Waiting on copy', assigneeAgentId: 'maya', agentStatus: 'awaiting-input', priority: 'normal', href: '/admin/org/acme/agent/board?task=task-2' },
          ] } }),
        } as Response)
      }
      if (url === '/api/v1/social/posts/pending?limit=12') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [
            { id: 'approval-1', orgId: 'org-1', orgName: 'Acme Co', platform: 'linkedin', content: 'Approve the launch post' },
          ] }),
        } as Response)
      }
      if (url === '/api/v1/dashboard/activity?limit=12') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [
            { id: 'activity-1', type: 'task_completed', note: 'Theo completed QA handoff', createdAt: new Date().toISOString() },
          ] }),
        } as Response)
      }
      if (url === '/api/v1/health') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { ok: true, services: { firestore: 'ok', auth: 'ok', storage: 'ok' } } }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<MissionControlDashboard />)

    expect(screen.getByText(/operating dashboard/i)).toBeInTheDocument()
    expect(screen.getByText(/loading dashboard signal/i)).toBeInTheDocument()

    await waitFor(() => expect(screen.getAllByText('Acme Co').length).toBeGreaterThan(0))

    expect(screen.getByText(/service strip/i)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /work board/i })).toBeInTheDocument()
    expect(screen.getAllByText(/approvals/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/today timeline/i)).toBeInTheDocument()
    expect(screen.getAllByText('Build campaign').length).toBeGreaterThan(0)
    expect(screen.getByText('Theo completed QA handoff')).toBeInTheDocument()

    const orgCard = screen.getAllByText('Acme Co').find(element => element.closest('a')?.getAttribute('href') === '/admin/org/acme/dashboard')?.closest('a')
    expect(orgCard).toHaveAttribute('href', '/admin/org/acme/dashboard')
    expect(orgCard).toHaveClass('group/card')
    expect(orgCard?.className).not.toContain('--color-border')
  })

  it('renders client workspace cards with business signal labels and no WebGL dependency', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [
            { id: 'org-1', name: 'Acme Co', slug: 'acme', status: 'active', type: 'client', memberCount: 3 },
            { id: 'org-2', name: 'Beta Studio', slug: 'beta', status: 'active', type: 'client', memberCount: 2 },
          ] }),
        } as Response)
      }
      if (url === '/api/v1/admin/agent-tasks?orgId=pib-platform-owner&assigneeAgentId=theo') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { cards: [
          { id: 'task-1', orgId: 'org-1', title: 'Build campaign', assigneeAgentId: 'theo', agentStatus: 'in-progress', href: '/admin/org/acme/projects/proj?task=task-1' },
          { id: 'task-2', orgId: 'org-2', title: 'Blocked handoff', assigneeAgentId: 'theo', agentStatus: 'blocked', href: '/admin/org/beta/projects/proj?task=task-2' },
        ] } }) } as Response)
      }
      if (url === '/api/v1/social/posts/pending?limit=12') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [
          { id: 'approval-1', orgId: 'org-2', orgName: 'Beta Studio', platform: 'linkedin', content: 'Approve launch post' },
        ] }) } as Response)
      }
      if (url === '/api/v1/health') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { ok: true, services: { firestore: 'ok' } } }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    const { container } = render(<MissionControlDashboard />)

    await waitFor(() => expect(screen.getAllByText('Acme Co').length).toBeGreaterThan(0))

    expect(screen.getAllByText(/client workspaces/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Attention').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Beta Studio').find(element => element.closest('a')?.getAttribute('href') === '/admin/org/beta/dashboard')).toBeTruthy()
    expect(container.querySelector('canvas')).not.toBeInTheDocument()
  })

  it('shows every client organisation in the constellation and card grid without including the platform owner', async () => {
    const orgs = Array.from({ length: 12 }, (_, index) => ({
      id: `client-${index + 1}`,
      name: `Client ${index + 1}`,
      slug: `client-${index + 1}`,
      status: 'active',
      type: 'client',
      memberCount: index,
    }))

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [...orgs, { id: 'pib-platform-owner', name: 'Partners in Biz', slug: 'partners-in-biz', status: 'active', type: 'platform_owner' }] }) } as Response)
      }
      if (url === '/api/v1/health') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { ok: true, services: { firestore: 'ok' } } }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<MissionControlDashboard />)

    await waitFor(() => expect(screen.getAllByText('Client 12').length).toBeGreaterThan(0))
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Clients')).toBeInTheDocument()
    expect(screen.getByText('Client 12').closest('a')).toHaveAttribute('href', '/admin/org/client-12/dashboard')
    expect(screen.queryByText('Partners in Biz')).not.toBeInTheDocument()
    orgs.forEach(org => {
      expect(screen.getAllByText(org.name).some(element => element.closest('a')?.getAttribute('href') === `/admin/org/${org.slug}/dashboard`)).toBe(true)
    })
  })

  it('groups software-build tasks into pending, in progress, blocked, review, and completed lanes with project titles and links', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [
          { id: 'pib-platform-owner', name: 'Partners in Biz', slug: 'partners-in-biz', status: 'active', type: 'platform_owner' },
        ] }) } as Response)
      }
      if (url === '/api/v1/admin/agent-tasks?orgId=pib-platform-owner&assigneeAgentId=theo') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { cards: [
          { id: 'pending-task', orgId: 'pib-platform-owner', title: 'Build queue shell', projectName: 'PiB Platform Alignment', assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', href: '/admin/org/partners-in-biz/projects/platform?task=pending-task' },
          { id: 'active-task', orgId: 'pib-platform-owner', title: 'Wire status cards', projectName: 'PiB Platform Alignment', assigneeAgentId: 'theo', agentStatus: 'in-progress', columnId: 'in_progress', href: '/admin/org/partners-in-biz/projects/platform?task=active-task' },
          { id: 'blocked-task', orgId: 'pib-platform-owner', title: 'Approval gate blocked', projectName: 'PiB Platform Alignment', assigneeAgentId: 'theo', agentStatus: 'awaiting-input', columnId: 'blocked', href: '/admin/org/partners-in-biz/projects/platform?task=blocked-task' },
          { id: 'review-task', orgId: 'pib-platform-owner', title: 'Review evidence links', projectName: 'PiB Platform Alignment', assigneeAgentId: 'theo', agentStatus: 'done', columnId: 'review', href: '/admin/org/partners-in-biz/projects/platform?task=review-task' },
          { id: 'completed-task', orgId: 'pib-platform-owner', title: 'Completed build card', projectName: 'PiB Platform Alignment', assigneeAgentId: 'theo', agentStatus: 'done', columnId: 'done', href: '/admin/org/partners-in-biz/projects/platform?task=completed-task' },
        ] } }) } as Response)
      }
      if (url === '/api/v1/health') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { ok: true, services: { firestore: 'ok' } } }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<MissionControlDashboard />)
    await waitFor(() => expect(screen.getByRole('tab', { name: /work board/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: /work board/i }))

    expect(screen.getByText('Software build queue')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getAllByText(/PiB Platform Alignment/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Build queue shell').some(node => node.closest('a')?.getAttribute('href') === '/admin/org/partners-in-biz/projects/platform?task=pending-task')).toBe(true)
    expect(screen.getAllByText('Completed build card').some(node => node.closest('a')?.getAttribute('href') === '/admin/org/partners-in-biz/projects/platform?task=completed-task')).toBe(true)
  })

  it('warns when an approved sprint has no active software-build tickets and links to gated spec creation', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [
          { id: 'pib-platform-owner', name: 'Partners in Biz', slug: 'partners-in-biz', status: 'active', type: 'platform_owner' },
        ] }) } as Response)
      }
      if (url === '/api/v1/admin/agent-tasks?orgId=pib-platform-owner&assigneeAgentId=theo') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { cards: [
          { id: 'review-task', orgId: 'pib-platform-owner', title: 'Review evidence links', projectName: 'PiB Platform Alignment', assigneeAgentId: 'theo', agentStatus: 'done', columnId: 'review', href: '/admin/org/partners-in-biz/projects/platform?task=review-task' },
          { id: 'completed-task', orgId: 'pib-platform-owner', title: 'Completed build card', projectName: 'PiB Platform Alignment', assigneeAgentId: 'theo', agentStatus: 'done', columnId: 'done', href: '/admin/org/partners-in-biz/projects/platform?task=completed-task' },
        ] } }) } as Response)
      }
      if (url === '/api/v1/health') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { ok: true, services: { firestore: 'ok' } } }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<MissionControlDashboard />)
    await waitFor(() => expect(screen.getByRole('tab', { name: /work board/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: /work board/i }))

    expect(screen.getByText('No active software build tickets')).toBeInTheDocument()
    expect(screen.getByText(/no pending or in-progress Theo build tickets/i)).toBeInTheDocument()
    expect(screen.getByText(/0 active \/ 2 total/i)).toBeInTheDocument()
    expect(screen.getByText('Create gated build spec').closest('a')).toHaveAttribute('href', '/admin/org/partners-in-biz/documents/new')
    expect(screen.getByText('Open Projects/Kanban').closest('a')).toHaveAttribute('href', '/admin/org/partners-in-biz/projects')
  })

  it('has excellent empty and error states', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      if (url === '/api/v1/health') {
        return Promise.reject(new Error('health unavailable'))
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<MissionControlDashboard />)

    await waitFor(() => expect(screen.getByText(/no active organisations/i)).toBeInTheDocument())
    expect(screen.getByText(/timeline is quiet/i)).toBeInTheDocument()
    expect(screen.getByText(/health unavailable/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /work board/i }))
    expect(screen.getByText(/no active pulses/i)).toBeInTheDocument()
    expect(screen.getByText(/approval lane is clear/i)).toBeInTheDocument()
  })
})
