import '@testing-library/jest-dom'
import { render, screen, waitFor, within } from '@testing-library/react'
import { PeetMissionControl } from '@/components/mission-control/PeetMissionControl'

jest.mock('next/link', () => {
  return function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return <a href={href} {...props}>{children}</a>
  }
})

const feedItems = [
  {
    id: 'approval:choice-ab',
    orgId: 'pib-platform-owner',
    priority: 'needs-peet',
    title: 'Peet approval: Choice A+B internal readiness approved',
    summary: 'Choice C controlled send remains blocked until sender, list, channel, opt-out, personalization, cap, and reply owner are specified.',
    source: { type: 'approval', id: 'g7fbjE9LYfAsRTqNtt5I', url: '/admin/projects/p0hFCZE3d4koqIrAaS1c' },
    actor: { id: 'pip', name: 'Pip', role: 'orchestrator' },
    context: { orgId: 'pib-platform-owner', orgName: 'Partners in Biz', projectId: 'p0hFCZE3d4koqIrAaS1c', projectName: 'Revenue Acquisition Sprint' },
    metadata: {
      decision: 'Approve internal readiness and property-network preparation only',
      softwareBuildEvidence: [{ kind: 'task', label: 'Approval gate', value: 'Choice A+B evidence', href: '/admin/projects/p0hFCZE3d4koqIrAaS1c?taskId=g7fbjE9LYfAsRTqNtt5I' }],
    },
    occurredAt: '2026-06-04T08:00:00.000Z',
  },
  {
    id: 'deal:hot-prospect',
    orgId: 'pib-platform-owner',
    priority: 'review',
    title: 'Revenue card: proposal-stage property network follow-up',
    summary: 'Hot prospect needs internal qualification before any external touch.',
    source: { type: 'deal', id: 'deal-1', url: '/admin/crm/deals/deal-1' },
    actor: { id: 'nora', name: 'Nora', role: 'crm' },
    context: { orgId: 'pib-platform-owner', orgName: 'Partners in Biz', dealId: 'deal-1', dealTitle: 'Property network sprint' },
    metadata: { revenueValue: 'R180k', nextAction: 'Prepare internal follow-up task' },
    occurredAt: '2026-06-04T08:20:00.000Z',
  },
  {
    id: 'agent-output:maya',
    orgId: 'pib-platform-owner',
    priority: 'progress',
    title: 'Agent output: property-network social shortlist ready',
    summary: 'Maya recommended seven proof-safe posts for review before publishing approval.',
    source: { type: 'agent-output', id: 'out-1', url: '/admin/briefings?source=agent-output&id=out-1' },
    actor: { id: 'maya', name: 'Maya', role: 'content' },
    context: { orgId: 'pib-platform-owner', orgName: 'Partners in Biz' },
    metadata: { nextAction: 'Review social shortlist' },
    occurredAt: '2026-06-04T08:35:00.000Z',
  },
  {
    id: 'task:blocker',
    orgId: 'pib-platform-owner',
    priority: 'client-risk',
    title: 'Client risk: production and external gates remain closed',
    summary: 'No send, publishing, spend, production, billing, secret, or destructive action is approved.',
    source: { type: 'task', id: 'risk-1', url: '/admin/projects/p0hFCZE3d4koqIrAaS1c' },
    actor: { id: 'pip', name: 'Pip' },
    context: { orgId: 'pib-platform-owner', orgName: 'Partners in Biz', taskId: 'risk-1' },
    occurredAt: '2026-06-04T08:40:00.000Z',
  },
]

const agentTasks = [
  { id: 'follow-1', title: 'Follow up: create Choice C approval packet', assigneeAgentId: 'docs', agentStatus: 'pending', columnId: 'todo', priority: 'urgent', href: '/admin/projects/p0hFCZE3d4koqIrAaS1c?task=follow-1' },
  { id: 'risk-1', title: 'Blocked: controlled send needs exact Peet approval wording', assigneeAgentId: 'nora', agentStatus: 'awaiting-input', columnId: 'blocked', priority: 'urgent', href: '/admin/projects/p0hFCZE3d4koqIrAaS1c?task=risk-1' },
]

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-06-04T09:15:00.000Z'))
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/v1/briefings/feed')) {
      return { ok: true, json: async () => ({ data: { items: feedItems, total: feedItems.length, hasMore: false, generatedAt: '2026-06-04T09:00:00.000Z' } }) } as Response
    }
    if (url.startsWith('/api/v1/admin/agent-tasks')) {
      return { ok: true, json: async () => ({ data: { items: agentTasks } }) } as Response
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('PeetMissionControl', () => {
  it('combines today decisions, approvals, revenue, client risks, agent outputs, follow-ups, and KPI snapshot', async () => {
    render(<PeetMissionControl />)

    expect(await screen.findByRole('heading', { name: 'Peet Mission Control' })).toBeInTheDocument()
    expect(screen.getByText('Internal development only')).toBeInTheDocument()

    await screen.findByText('Generated 04 Jun, 09:00')
    const kpis = screen.getByLabelText('Mission Control KPI snapshot')
    expect(within(kpis).getByText('4')).toBeInTheDocument()
    expect(within(kpis).getByText('Live cards')).toBeInTheDocument()
    expect(within(kpis).getAllByText('2').length).toBeGreaterThanOrEqual(1)
    expect(within(kpis).getByText('Follow-ups')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Today’s decisions' })).toBeInTheDocument()
    const decisionLink = screen.getByRole('link', { name: /Approve internal readiness and property-network preparation only/i })
    expect(decisionLink).toHaveAttribute('href', '/admin/projects/p0hFCZE3d4koqIrAaS1c?taskId=g7fbjE9LYfAsRTqNtt5I')
    expect(screen.getByText('Approve internal readiness and property-network preparation only')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Approvals and gates' })).toBeInTheDocument()
    expect(screen.getAllByText(/Choice C controlled send remains blocked/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'Revenue cards' })).toBeInTheDocument()
    expect(screen.getByText(/R180k/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Client risks' })).toBeInTheDocument()
    expect(screen.getAllByText(/external gates remain closed/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'Agent outputs' })).toBeInTheDocument()
    expect(screen.getAllByText(/property-network social shortlist ready/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'Follow-ups' })).toBeInTheDocument()
    expect(screen.getByText('Follow up: create Choice C approval packet')).toBeInTheDocument()
  })

  it('fetches the platform scoped briefing and task feeds', async () => {
    render(<PeetMissionControl />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/briefings/feed?orgId=pib-platform-owner'))
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/agent-tasks?orgId=pib-platform-owner'))
  })

  it('warns when the briefing generatedAt timestamp is older than 30 minutes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-04T09:45:01.000Z'))
    render(<PeetMissionControl />)

    expect(await screen.findByText(/Mission Control briefing data may be stale/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Generated 04 Jun, 09:00/i).length).toBeGreaterThanOrEqual(1)
  })

  it('warns when the briefing generatedAt timestamp is missing', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/briefings/feed')) {
        return { ok: true, json: async () => ({ data: { items: feedItems, total: feedItems.length, hasMore: false } }) } as Response
      }
      if (url.startsWith('/api/v1/admin/agent-tasks')) {
        return { ok: true, json: async () => ({ data: { items: agentTasks } }) } as Response
      }
      throw new Error(`Unexpected fetch ${url}`)
    })

    render(<PeetMissionControl />)

    expect(await screen.findByText(/Mission Control briefing data may be stale/i)).toBeInTheDocument()
    expect(screen.getAllByText(/No valid generatedAt timestamp/i).length).toBeGreaterThanOrEqual(1)
  })

  it('warns when the briefing generatedAt timestamp is invalid', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/briefings/feed')) {
        return { ok: true, json: async () => ({ data: { items: feedItems, total: feedItems.length, hasMore: false, generatedAt: 'not-a-date' } }) } as Response
      }
      if (url.startsWith('/api/v1/admin/agent-tasks')) {
        return { ok: true, json: async () => ({ data: { items: agentTasks } }) } as Response
      }
      throw new Error(`Unexpected fetch ${url}`)
    })

    render(<PeetMissionControl />)

    expect(await screen.findByText(/Mission Control briefing data may be stale/i)).toBeInTheDocument()
    expect(screen.getAllByText(/No valid generatedAt timestamp/i).length).toBeGreaterThanOrEqual(1)
  })
})
