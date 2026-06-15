import '@testing-library/jest-dom'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
    id: 'agent-learning-review:weekly-1',
    orgId: 'pib-platform-owner',
    priority: 'review',
    title: 'Weekly Agent Learning Review - PiB platform',
    summary: 'Review proposed learning items. No automatic skill or wiki rewrites.',
    source: { type: 'agent-learning-review', id: 'weekly-1', url: '/admin/projects/project-learning?taskId=weekly-1' },
    actor: { id: 'pip', name: 'Pip', role: 'orchestrator' },
    context: { orgId: 'pib-platform-owner', orgName: 'Partners in Biz', taskId: 'weekly-1' },
    metadata: {
      agentLearningReview: {
        reviewGate: 'proposals-only',
        dashboard: {
          skillsChanged: [{ label: 'partnersinbiz/platform-ops updated', href: '/admin/skills/partnersinbiz/platform-ops' }],
          mistakesReduced: [{ label: 'Stopped repeating approval-gate drift' }],
          staleInstructionsFound: [{ label: 'Old cron SOP still said auto-apply skills' }],
          blockedTasksPrevented: [{ label: 'Dependency gate prevented premature Theo pickup' }],
          newSopsProposed: [{ label: 'Weekly learning review SOP' }],
          knowledgeCaptured: [{ label: 'Agent learning log', href: '/admin/wiki/partners/agent-learning' }],
        },
      },
    },
    occurredAt: '2026-06-04T08:50:00.000Z',
  },
  {
    id: 'business-insight-review:crm-gap',
    orgId: 'pib-platform-owner',
    priority: 'needs-peet',
    title: 'Business Insight: Three high-intent CRM leads have no owner',
    summary: 'Potential response-time revenue leakage. Assign Blake to triage the leads and create a follow-up task.',
    source: { type: 'business-insight-review', id: 'crm-gap', url: '/admin/projects/growth-project?taskId=task-insight-1' },
    actor: { id: 'pip', name: 'Pip', role: 'orchestrator' },
    context: { orgId: 'pib-platform-owner', orgName: 'Partners in Biz', taskId: 'task-insight-1' },
    metadata: {
      businessInsightReview: {
        reviewGate: 'internal-proposals-only',
        lane: 'crm',
        insightKind: 'follow-up-gap',
        businessImpact: { estimateLabel: 'Potential response-time revenue leakage', confidence: 78 },
        evidence: [{ label: 'High-intent leads without owner', value: '3' }],
        recommendation: { nextAction: 'Assign Blake to triage the leads and create a follow-up task.', ownerAgentId: 'sales', approvalGate: 'human-review' },
        score: { total: 77 },
        suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
      },
    },
    occurredAt: '2026-06-04T08:55:00.000Z',
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

const generatedAt = '2026-06-04T09:00:00.000Z'
const generatedAtLabel = `Generated ${new Date(generatedAt).toLocaleString('en-ZA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-06-04T09:15:00.000Z'))
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/v1/briefings/feed')) {
      return { ok: true, json: async () => ({ data: { items: feedItems, total: feedItems.length, hasMore: false, generatedAt } }) } as Response
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

async function renderMissionControl() {
  let result: ReturnType<typeof render> | null = null
  await act(async () => {
    result = render(<PeetMissionControl />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  return result as ReturnType<typeof render>
}

describe('PeetMissionControl', () => {
  it('combines today decisions, approvals, revenue, client risks, agent outputs, follow-ups, and KPI snapshot', async () => {
    await renderMissionControl()

    expect(await screen.findByRole('heading', { name: 'Peet Mission Control' })).toBeInTheDocument()
    expect(screen.getByText('Internal development only')).toBeInTheDocument()

    await screen.findByText(generatedAtLabel)
    const kpis = screen.getByLabelText('Mission Control KPI snapshot')
    expect(within(kpis).getByText('6')).toBeInTheDocument()
    expect(within(kpis).getByText('Live cards')).toBeInTheDocument()
    expect(within(kpis).getAllByText('2').length).toBeGreaterThanOrEqual(1)
    expect(within(kpis).getByText('Follow-ups')).toBeInTheDocument()
    expect(within(kpis).getByText('Business insights')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Today’s decisions' })).toBeInTheDocument()
    const decisionLink = screen.getByRole('link', { name: /Approve internal readiness and property-network preparation only/i })
    expect(decisionLink).toHaveAttribute('href', '/admin/projects/p0hFCZE3d4koqIrAaS1c?taskId=g7fbjE9LYfAsRTqNtt5I')
    expect(screen.getByText('Approve internal readiness and property-network preparation only')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Approvals and gates' })).toBeInTheDocument()
    expect(screen.getAllByText(/Choice C controlled send remains blocked/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'Revenue cards' })).toBeInTheDocument()
    expect(screen.getByText(/R180k/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scoped org risks' })).toBeInTheDocument()
    expect(screen.getAllByText(/external gates remain closed/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'Agent outputs' })).toBeInTheDocument()
    expect(screen.getAllByText(/property-network social shortlist ready/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'Agent Learning dashboard' })).toBeInTheDocument()
    const learningDashboard = screen.getByLabelText('Agent Learning dashboard')
    expect(within(learningDashboard).getByText('Skills added/updated')).toBeInTheDocument()
    expect(within(learningDashboard).getByText('partnersinbiz/platform-ops updated')).toBeInTheDocument()
    expect(within(learningDashboard).getByText('Recurring mistakes reduced')).toBeInTheDocument()
    expect(within(learningDashboard).getByText('Stopped repeating approval-gate drift')).toBeInTheDocument()
    expect(within(learningDashboard).getByText('Stale instructions found')).toBeInTheDocument()
    expect(within(learningDashboard).getByText('Blocked tasks prevented')).toBeInTheDocument()
    expect(within(learningDashboard).getByText('New SOPs proposed')).toBeInTheDocument()
    expect(within(learningDashboard).getByText('Org/project knowledge captured')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Business Insights dashboard' })).toBeInTheDocument()
    const businessInsightDashboard = screen.getByLabelText('Business Insights dashboard')
    expect(within(businessInsightDashboard).getByText('CRM')).toBeInTheDocument()
    expect(within(businessInsightDashboard).getByText('Potential response-time revenue leakage')).toBeInTheDocument()
    expect(within(businessInsightDashboard).getByText('Assign Blake to triage the leads and create a follow-up task.')).toBeInTheDocument()
    expect(within(businessInsightDashboard).getByText('High-intent leads without owner')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Follow-ups' })).toBeInTheDocument()
    expect(screen.getByText('Follow up: create Choice C approval packet')).toBeInTheDocument()
  })

  it('fetches the platform scoped briefing and task feeds', async () => {
    await renderMissionControl()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/briefings/feed?orgId=pib-platform-owner'))
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/agent-tasks?orgId=pib-platform-owner'))
  })

  it('warns when the briefing generatedAt timestamp is older than 30 minutes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-04T09:45:01.000Z'))
    await renderMissionControl()

    expect(await screen.findByText(/Mission Control briefing data may be stale/i)).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(generatedAtLabel, 'i')).length).toBeGreaterThanOrEqual(1)
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

    await renderMissionControl()

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

    await renderMissionControl()

    expect(await screen.findByText(/Mission Control briefing data may be stale/i)).toBeInTheDocument()
    expect(screen.getAllByText(/No valid generatedAt timestamp/i).length).toBeGreaterThanOrEqual(1)
  })
})
