import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import MissionControlDashboard from '@/app/(admin)/admin/dashboard/page'

jest.mock('next/link', () => {
  return function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>
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
      if (url === '/api/v1/admin/agent-tasks?assigneeAgentId=theo') {
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

    await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())

    expect(screen.getByText(/health strip/i)).toBeInTheDocument()
    expect(screen.getByText(/task pulse/i)).toBeInTheDocument()
    expect(screen.getByText(/approval radar/i)).toBeInTheDocument()
    expect(screen.getByText(/today timeline/i)).toBeInTheDocument()
    expect(screen.getAllByText('Build campaign').length).toBeGreaterThan(0)
    expect(screen.getByText('Approve the launch post')).toBeInTheDocument()
    expect(screen.getByText('Theo completed QA handoff')).toBeInTheDocument()
    expect(screen.getByText(/1 active task/i)).toBeInTheDocument()

    const orgCard = screen.getByText('Acme Co').closest('a')
    expect(orgCard).toHaveClass('pib-card')
    expect(orgCard).toHaveClass('pib-card-hover')
    expect(orgCard?.className).not.toContain('--color-border')
  })

  it('renders the motion layer as an accessible CSS/SVG progressive enhancement without a WebGL dependency', async () => {
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
      if (url === '/api/v1/admin/agent-tasks?assigneeAgentId=theo') {
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

    expect(screen.getByText(/motion layer: css\/svg/i)).toBeInTheDocument()
    expect(screen.getByText(/three\.js deferred/i)).toBeInTheDocument()
    expect(screen.getByTestId('mission-control-constellation')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('canvas')).not.toBeInTheDocument()
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
