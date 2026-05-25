import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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

    expect(screen.getByText(/mission control/i)).toBeInTheDocument()
    expect(screen.getByText(/loading command signal/i)).toBeInTheDocument()

    await waitFor(() => expect(screen.getAllByText('Acme Co').length).toBeGreaterThan(0))

    expect(screen.getByText(/health strip/i)).toBeInTheDocument()
    expect(screen.getByText(/task pulse/i)).toBeInTheDocument()
    expect(screen.getByText(/approval radar/i)).toBeInTheDocument()
    expect(screen.getByText(/today timeline/i)).toBeInTheDocument()
    expect(screen.getAllByText('Build campaign').length).toBeGreaterThan(0)
    expect(screen.getByText('Approve the launch post')).toBeInTheDocument()
    expect(screen.getByText('Theo completed QA handoff')).toBeInTheDocument()
    expect(screen.getAllByText(/1 active task/i).length).toBeGreaterThan(0)

    const orgCard = screen.getAllByText('Acme Co').find(element => element.closest('a')?.className.includes('pib-card'))?.closest('a')
    expect(orgCard).toHaveAttribute('href', '/admin/org/acme/dashboard')
    expect(orgCard).toHaveClass('pib-card')
    expect(orgCard).toHaveClass('pib-card-hover')
    expect(orgCard?.className).not.toContain('--color-border')
  })

  it('renders the constellation as an accessible business signal map with hover/focus labels and no WebGL dependency', async () => {
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

    await waitFor(() => expect(container.querySelectorAll('[data-constellation-node]')).toHaveLength(2))

    expect(screen.getByText(/business signal map/i)).toBeInTheDocument()
    expect(screen.getByText(/Each dot is a client workspace/i)).toBeInTheDocument()
    expect(screen.getByTestId('mission-control-constellation')).toHaveAttribute('role', 'list')
    expect(screen.getByTestId('mission-control-constellation')).toHaveAttribute('aria-label', 'Client workspace signal map')
    expect(screen.getByLabelText(/Acme Co: Work moving/i)).toHaveAttribute('title', expect.stringContaining('Acme Co: Work moving'))
    expect(screen.getByLabelText(/Beta Studio: Needs attention/i)).toHaveAttribute('href', '/admin/org/beta/dashboard')
    expect(screen.getByText(/Needs attention · 0 active tasks · 1 risk item · 1 approval/i)).toBeInTheDocument()
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

    const { container } = render(<MissionControlDashboard />)

    await waitFor(() => expect(container.querySelectorAll('[data-constellation-node]')).toHaveLength(12))
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Clients')).toBeInTheDocument()
    expect(screen.getByLabelText(/Client 12: Calm/i)).toHaveAttribute('href', '/admin/org/client-12/dashboard')
    expect(screen.queryByLabelText(/Partners in Biz:/i)).not.toBeInTheDocument()
    orgs.forEach(org => {
      expect(screen.getAllByText(org.name).some(element => element.closest('a')?.className.includes('pib-card'))).toBe(true)
    })
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
    expect(screen.getByText(/no task pulses yet/i)).toBeInTheDocument()
    expect(screen.getByText(/approval radar is clear/i)).toBeInTheDocument()
    expect(screen.getByText(/timeline is quiet/i)).toBeInTheDocument()
    expect(screen.getByText(/health unavailable/i)).toBeInTheDocument()
  })
})
