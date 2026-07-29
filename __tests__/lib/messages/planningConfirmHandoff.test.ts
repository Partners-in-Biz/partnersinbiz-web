jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: jest.fn(),
  messagesCollection: jest.fn(),
}))

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import {
  attachPlanningConfirmToAssistantMessage,
  buildPlanningConfirmPresentation,
  handoffPlanningConfirmFromDiscovery,
} from '@/lib/messages/planningConfirmHandoff'

const brief = {
  outcome: 'Ship seller CRM dependency chain',
  user: 'Hunt & Gun sellers and dealers',
  whyNow: 'Dependency gate is blocking execution',
  successCriteria: ['Confirmed brief', 'Watcher releases chain'],
  constraints: ['development branch only'],
  outOfScope: ['Production deploy without approval'],
  assumptions: ['Existing dependency chain remains correct'],
  risks: ['Stale brief'],
  approvalGates: ['human Decision Brief confirm'],
}

describe('planningConfirmHandoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('builds a human-session confirm action with payload bodyMode', () => {
    const presentation = buildPlanningConfirmPresentation({
      projectId: 'proj-1',
      projectLabel: 'Hunt & Gun — Seller CRM Development',
      revision: 5,
      digest: 'abc123digest',
      brief,
    })

    expect(presentation.richParts[0]).toMatchObject({
      type: 'approval_card',
      statusLabel: 'Needs your confirm',
    })
    expect(presentation.uiActions[0]).toMatchObject({
      type: 'approve',
      label: 'Confirm Decision Brief',
      method: 'POST',
      bodyMode: 'payload',
      endpoint: '/api/v1/projects/proj-1/planning-discovery',
      payload: {
        type: 'confirm',
        expectedRevision: 5,
        expectedDigest: 'abc123digest',
      },
    })
    expect(presentation.uiActions[1]).toMatchObject({
      type: 'open_context',
      payload: { kind: 'project', id: 'proj-1' },
    })
    expect(presentation.contextRef).toMatchObject({ type: 'project', id: 'proj-1' })
  })

  it('attaches approval card + confirm actions to the assistant message', async () => {
    const update = jest.fn(async () => undefined)
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
    ;(messagesCollection as jest.Mock).mockReturnValue({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: 'assistant', uiActions: [], richParts: [] }) }),
        update,
      }),
    })

    const presentation = buildPlanningConfirmPresentation({
      projectId: 'proj-1',
      projectLabel: 'Hunt & Gun',
      revision: 2,
      digest: 'digest-2',
      brief,
    })
    const result = await attachPlanningConfirmToAssistantMessage({
      orgId: 'org-1',
      conversationId: 'c1',
      responseMessageId: 'asst-1',
      presentation,
    })

    expect(result).toEqual({ attached: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      uiActions: expect.arrayContaining([
        expect.objectContaining({ bodyMode: 'payload', payload: expect.objectContaining({ type: 'confirm' }) }),
      ]),
      richParts: expect.arrayContaining([
        expect.objectContaining({ type: 'approval_card' }),
      ]),
      contextRefs: expect.arrayContaining([
        expect.objectContaining({ type: 'project', id: 'proj-1' }),
      ]),
    }))
  })

  it('handoff is a no-op without conversation handoff ids', async () => {
    const result = await handoffPlanningConfirmFromDiscovery({
      orgId: 'org-1',
      body: {},
      projectId: 'proj-1',
      revision: 1,
      digest: 'd1',
      brief,
    })
    expect(result.messagesAttach).toEqual({ attached: false, reason: 'missing_handoff_ids' })
    expect(result.uiActions[0].bodyMode).toBe('payload')
  })
})
