jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: jest.fn(),
  messagesCollection: jest.fn(),
}))

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import {
  attachDesignAuditCardToAssistantMessage,
  buildDesignAuditCardPresentation,
  handoffDesignAuditCardFromCreate,
} from '@/lib/design-audit/audit-card'
import type { DesignAuditRun } from '@/lib/design-audit/audit-runs'

function makeRun(overrides: Partial<DesignAuditRun> = {}): DesignAuditRun {
  return {
    id: 'dar_abc123',
    orgId: 'org-1',
    url: 'https://example.com/',
    scope: 'all',
    status: 'done',
    exitCode: 2,
    summary: { total: 2, bySeverity: { P0: 1, P1: 1, P2: 0, P3: 0 }, byScope: { type: 2 } },
    findings: [
      { rule: 'tiny-body-text', severity: 'P1', scope: 'type', ref: 'p:nth-of-type(1)', line: 2, snippet: '<p>', message: 'Body text too small', value: '11px' },
      { rule: 'purple-gradients', severity: 'P0', scope: 'layout', ref: 'section.hero', line: 1, snippet: '<section>', message: 'Purple gradient' },
    ],
    notes: [],
    errors: [],
    designSystemPresent: false,
    screenshotUrl: 'https://cdn.example/frame.jpg',
    waivers: [{ id: 'w_1', rule: 'tiny-body-text', ref: 'p:nth-of-type(1)', reason: 'Legal footer', createdAtMs: 100 }],
    createdBy: 'user-1',
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  }
}

describe('design-audit audit-card presentation', () => {
  it('builds a design_audit rich part grouped P0-P3 with element refs and screenshot', () => {
    const presentation = buildDesignAuditCardPresentation({ run: makeRun() })

    expect(presentation.richParts[0]).toMatchObject({
      type: 'design_audit',
      title: 'Design audit — https://example.com/',
      statusLabel: '2 findings',
    })
    const part = presentation.richParts[0]
    expect(part.metrics).toEqual([
      { label: 'P0', value: 1 },
      { label: 'P1', value: 1 },
      { label: 'P2', value: 0 },
      { label: 'P3', value: 0 },
    ])
    expect(part.sections?.[0].heading).toBe('P0 — 1')
    expect(part.sections?.[0].items?.[0]).toContain('purple-gradients')
    expect(part.images?.[0]).toMatchObject({ url: 'https://cdn.example/frame.jpg' })
  })

  it('reports clean when no findings', () => {
    const run = makeRun({ exitCode: 0, summary: { total: 0, bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }, byScope: {} }, findings: [] })
    const presentation = buildDesignAuditCardPresentation({ run })
    expect(presentation.richParts[0].statusLabel).toBe('Clean')
  })

  it('emits Fix it / Ignore + reason / Re-run / open_context uiActions', () => {
    const presentation = buildDesignAuditCardPresentation({ run: makeRun() })
    const actionIds = presentation.uiActions.map((a) => a.actionId ?? a.id)
    expect(presentation.uiActions[0]).toMatchObject({ type: 'custom', actionId: 'design-audit:fix-it', label: 'Fix it' })
    expect(presentation.uiActions[1]).toMatchObject({ type: 'custom', actionId: 'design-audit:ignore', label: 'Ignore + reason' })
    expect(presentation.uiActions[2]).toMatchObject({ type: 'custom', actionId: 'design-audit:rerun', label: 'Re-run' })
    expect(presentation.uiActions[3]).toMatchObject({ type: 'open_context', payload: { kind: 'design', id: 'dar_abc123' } })
    expect(actionIds).toHaveLength(4)
  })

  it('builds a design contextRef', () => {
    const presentation = buildDesignAuditCardPresentation({ run: makeRun() })
    expect(presentation.contextRef).toMatchObject({ type: 'design', id: 'dar_abc123', origin: 'manual' })
  })
})

describe('design-audit card attach handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('attaches richParts + uiActions + contextRefs to the assistant message', async () => {
    const update = jest.fn(async (_payload: Record<string, unknown>) => undefined)
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
    ;(messagesCollection as jest.Mock).mockReturnValue({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: 'assistant', uiActions: [], richParts: [], contextRefs: [] }) }),
        update,
      }),
    })

    const presentation = buildDesignAuditCardPresentation({ run: makeRun() })
    const result = await attachDesignAuditCardToAssistantMessage({
      orgId: 'org-1',
      conversationId: 'c1',
      responseMessageId: 'asst-1',
      presentation,
    })
    expect(result).toEqual({ attached: true })
    const payload = update.mock.calls[0]![0] as Record<string, unknown>
    expect((payload.richParts as Array<{ type: string }>)[0].type).toBe('design_audit')
    expect((payload.uiActions as unknown[]).length).toBe(4)
    expect((payload.contextRefs as Array<{ type: string; id: string }>)[0]).toMatchObject({ type: 'design', id: 'dar_abc123' })
  })

  it('no-ops when handoff ids are missing', async () => {
    const presentation = buildDesignAuditCardPresentation({ run: makeRun() })
    const result = await attachDesignAuditCardToAssistantMessage({ orgId: 'org-1', presentation })
    expect(result).toEqual({ attached: false, reason: 'missing_handoff_ids' })
  })

  it('rejects org mismatch', async () => {
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-other' })
    const presentation = buildDesignAuditCardPresentation({ run: makeRun() })
    const result = await attachDesignAuditCardToAssistantMessage({
      orgId: 'org-1',
      conversationId: 'c1',
      responseMessageId: 'asst-1',
      presentation,
    })
    expect(result).toEqual({ attached: false, reason: 'org_mismatch' })
  })

  it('handoffDesignAuditCardFromCreate parses handoff ids from the body', async () => {
    const update = jest.fn(async () => undefined)
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
    ;(messagesCollection as jest.Mock).mockReturnValue({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: 'assistant', uiActions: [], richParts: [], contextRefs: [] }) }),
        update,
      }),
    })
    const result = await handoffDesignAuditCardFromCreate({
      orgId: 'org-1',
      body: { conversationId: 'c1', responseMessageId: 'asst-1' },
      run: makeRun(),
    })
    expect(result.messagesAttach).toEqual({ attached: true })
    expect(result.richParts[0].type).toBe('design_audit')
  })
})
