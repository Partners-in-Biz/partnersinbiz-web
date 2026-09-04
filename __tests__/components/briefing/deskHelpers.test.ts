import { canStopAgentRun, harvestPipDraft } from '@/components/briefing/deskHelpers'
import type { BriefingCard } from '@/components/briefing/cockpit/cockpitTypes'

function runCard(overrides: Partial<BriefingCard> & { metadata?: Record<string, unknown> } = {}): BriefingCard {
  return {
    id: 'agent-run:run-1',
    orgId: 'org-1',
    priority: 'progress',
    title: 'Theo is running',
    summary: 'Theo has active work in progress.',
    source: { type: 'agent-run', id: 'run-1', url: '/admin/agents/theo?run=run-live-1' },
    actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
    context: { orgId: 'org-1', agentRunId: 'run-live-1' },
    metadata: { agentId: 'theo', runStatus: 'running', hermesRunId: 'run-live-1' },
    occurredAt: '2026-05-31T09:48:00.000Z',
    ...overrides,
  } as BriefingCard
}

describe('canStopAgentRun', () => {
  it('allows admins to stop live or paused Hermes runs', () => {
    expect(canStopAgentRun(runCard(), 'admin')).toBe(true)
    expect(canStopAgentRun(runCard({ metadata: { runStatus: 'waiting_for_approval', hermesRunId: 'run-live-1' } }), 'admin')).toBe(true)
  })

  it('refuses in portal mode, for finished runs, and for non-run cards', () => {
    expect(canStopAgentRun(runCard(), 'portal')).toBe(false)
    expect(canStopAgentRun(runCard({ metadata: { runStatus: 'completed', hermesRunId: 'run-live-1' } }), 'admin')).toBe(false)
    expect(canStopAgentRun(runCard({ metadata: { runStatus: 'failed', hermesRunId: 'run-live-1' } }), 'admin')).toBe(false)
    expect(canStopAgentRun(runCard({ source: { type: 'task', id: 't-1', url: '/x' } as BriefingCard['source'] }), 'admin')).toBe(false)
  })

  it('needs a run id and an org id to build the stop route', () => {
    expect(canStopAgentRun(runCard({ context: { orgId: 'org-1' } as BriefingCard['context'], metadata: { runStatus: 'running' } }), 'admin')).toBe(false)
    expect(canStopAgentRun(runCard({ orgId: '', context: { orgId: '', agentRunId: 'run-live-1' } as BriefingCard['context'] }), 'admin')).toBe(false)
  })
})

describe('harvestPipDraft', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns the newest settled assistant message', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          messages: [
            { id: 'm1', role: 'user', content: 'Draft a reply to Buhle' },
            { id: 'm2', role: 'assistant', content: 'Hi Buhle, thanks for reaching out…' },
            { id: 'm3', role: 'assistant', content: '', status: 'pending' },
          ],
        },
      }),
    })) as unknown as typeof fetch

    await expect(harvestPipDraft('conv-1')).resolves.toBe('Hi Buhle, thanks for reaching out…')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages')
  })

  it('returns null when the request fails or there is no assistant reply', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
    await expect(harvestPipDraft('conv-1')).resolves.toBeNull()

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { messages: [{ id: 'm1', role: 'user', content: 'hello' }] } }),
    })) as unknown as typeof fetch
    await expect(harvestPipDraft('conv-1')).resolves.toBeNull()
  })
})
