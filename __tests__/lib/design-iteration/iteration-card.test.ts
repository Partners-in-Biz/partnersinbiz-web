jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: jest.fn(),
  messagesCollection: jest.fn(),
}))

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import {
  attachDesignIterationCardToAssistantMessage,
  buildDesignIterationCardPresentation,
  handoffDesignIterationCardFromCreate,
} from '@/lib/design-iteration/iteration-card'
import type { DesignIterationSession } from '@/lib/design-iteration/types'

function makeSession(overrides: Partial<DesignIterationSession> = {}): DesignIterationSession {
  return {
    id: 'di_abc123',
    orgId: 'org-1',
    url: 'https://example.com/',
    instruction: 'make the hero bolder, keep sharp corners',
    elementRefs: [{ ref: '@e12', name: 'Hero heading' }],
    screenshotUrl: 'https://cdn.example/baseline.jpg',
    variants: [
      { id: 'v_1', archetype: 'Bolder hero', description: 'Larger display scale, stronger contrast.', changeType: 'dom-css', screenshotUrl: 'https://cdn.example/v1.jpg', status: 'pending', createdAtMs: 1000 },
      { id: 'v_2', archetype: 'Sharp corners', description: 'Zero-radius cards, crisp edges.', changeType: 'dom-css', screenshotUrl: 'https://cdn.example/v2.jpg', status: 'pending', createdAtMs: 1000 },
    ],
    status: 'review',
    createdBy: 'agent:theo',
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  }
}

describe('design-iteration card presentation', () => {
  it('builds a design_iteration rich part with variant sections and baseline screenshot', () => {
    const presentation = buildDesignIterationCardPresentation({ session: makeSession() })

    expect(presentation.richParts[0]).toMatchObject({
      type: 'design_iteration',
      title: 'Design this page — https://example.com/',
      statusLabel: '2 variants · 2 pending',
    })
    const part = presentation.richParts[0]
    expect(part.body).toContain('make the hero bolder, keep sharp corners')
    expect(part.body).toContain('@e12')
    expect(part.images?.[0]).toMatchObject({ url: 'https://cdn.example/baseline.jpg' })
    expect(part.metrics).toEqual([
      { label: 'Variants', value: 2 },
      { label: 'Pending', value: 2 },
      { label: 'Accepted', value: 0 },
      { label: 'Rejected', value: 0 },
    ])
    expect(part.sections?.[0].heading).toContain('Bolder hero')
    expect(part.sections?.[1].heading).toContain('Sharp corners')
  })

  it('emits Accept/Reject uiActions per pending variant + open_context', () => {
    const presentation = buildDesignIterationCardPresentation({ session: makeSession() })
    const accepts = presentation.uiActions.filter((a) => a.actionId === 'design-iteration:accept')
    const rejects = presentation.uiActions.filter((a) => a.actionId === 'design-iteration:reject')
    expect(accepts).toHaveLength(2)
    expect(rejects).toHaveLength(2)
    expect(accepts[0]).toMatchObject({ type: 'custom', label: 'Accept: Bolder hero', payload: { sessionId: 'di_abc123', variantId: 'v_1' } })
    expect(presentation.uiActions.at(-1)).toMatchObject({ type: 'open_context', payload: { kind: 'design', id: 'di_abc123' } })
  })

  it('reports accepted status and hides buttons for decided variants', () => {
    const session = makeSession({
      variants: [
        { id: 'v_1', archetype: 'Bolder hero', description: 'x', changeType: 'dom-css', status: 'accepted', decidedAtMs: 2000, createdAtMs: 1000 },
        { id: 'v_2', archetype: 'Sharp corners', description: 'y', changeType: 'dom-css', status: 'rejected', decidedAtMs: 2000, createdAtMs: 1000 },
      ],
      status: 'accepted',
      acceptedVariantId: 'v_1',
    })
    const presentation = buildDesignIterationCardPresentation({ session })
    expect(presentation.richParts[0].statusLabel).toBe('Accepted: Bolder hero')
    const actionIds = presentation.uiActions.map((a) => a.actionId ?? a.id)
    expect(actionIds.filter((id) => id === 'design-iteration:accept')).toHaveLength(0)
  })

  it('reports applied status with repo evidence', () => {
    const session = makeSession({
      variants: [{ id: 'v_1', archetype: 'Bolder hero', description: 'x', changeType: 'dom-css', status: 'accepted', createdAtMs: 1000 }],
      status: 'applied',
      acceptedVariantId: 'v_1',
      apply: { repo: 'partnersinbiz-web-development', branch: 'development', filesChanged: ['app/page.tsx'], diffSummary: '+12 -3', detectorExitCode: 0, detectorFindings: 0, appliedAtMs: 3000 },
    })
    const presentation = buildDesignIterationCardPresentation({ session })
    expect(presentation.richParts[0].statusLabel).toBe('Applied')
    expect(presentation.richParts[0].evidence).toContain('Applied to partnersinbiz-web-development (development)')
    expect(presentation.uiActions.at(-1)).toMatchObject({ type: 'open_context', label: 'View applied change' })
  })

  it('builds a design contextRef', () => {
    const presentation = buildDesignIterationCardPresentation({ session: makeSession() })
    expect(presentation.contextRef).toMatchObject({ type: 'design', id: 'di_abc123', origin: 'manual' })
  })
})

describe('design-iteration card attach', () => {
  it('attaches richParts + uiActions + contextRef to the assistant message', async () => {
    const msgRef = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'assistant', richParts: [], uiActions: [], contextRefs: [] }) }),
      update: jest.fn().mockResolvedValue(undefined),
    }
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
    ;(messagesCollection as jest.Mock).mockReturnValue({ doc: jest.fn().mockReturnValue(msgRef) })

    const result = await attachDesignIterationCardToAssistantMessage({
      orgId: 'org-1',
      conversationId: 'c1',
      responseMessageId: 'm1',
      presentation: buildDesignIterationCardPresentation({ session: makeSession() }),
    })
    expect(result.attached).toBe(true)
    const update = msgRef.update.mock.calls[0][0]
    expect(update.richParts[0].type).toBe('design_iteration')
    expect(update.uiActions.length).toBeGreaterThan(0)
    expect(update.contextRefs[0].id).toBe('di_abc123')
  })

  it('refuses to attach to a foreign org', async () => {
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-2' })
    const result = await attachDesignIterationCardToAssistantMessage({
      orgId: 'org-1',
      conversationId: 'c1',
      responseMessageId: 'm1',
      presentation: buildDesignIterationCardPresentation({ session: makeSession() }),
    })
    expect(result).toMatchObject({ attached: false, reason: 'org_mismatch' })
  })

  it('handoff is a safe no-op without handoff ids', async () => {
    const result = await handoffDesignIterationCardFromCreate({
      orgId: 'org-1',
      body: {},
      session: makeSession(),
    })
    expect(result.messagesAttach).toMatchObject({ attached: false, reason: 'missing_handoff_ids' })
  })
})
