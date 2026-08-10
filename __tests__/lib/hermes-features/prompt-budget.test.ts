import { buildPromptBudget, countPromptTokens } from '@/lib/hermes-features/prompt-budget'
import { classifyMessagesPromptIntent } from '@/lib/messages/prompt-profile'

describe('prompt budget and intent profiles', () => {
  it('uses a tokenizer-backed count and preserves critical request blocks over optional context', () => {
    const result = buildPromptBudget({ profile: 'read_only', limitTokens: 80, blocks: [
      { id: 'optional', priority: 'optional', content: 'filler '.repeat(20_000) },
      { id: 'request', priority: 'critical', content: 'User request: fix the task handoff.' },
      { id: 'identity', priority: 'critical', content: 'orgId: org-1' },
    ] })

    expect(countPromptTokens('The quick brown fox')).toBeGreaterThan(0)
    expect(result.content).toContain('User request: fix the task handoff.')
    expect(result.content).toContain('orgId: org-1')
    expect(countPromptTokens(result.content)).toBeLessThanOrEqual(80)
    expect(result.ledger.omitted).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'optional', reason: 'budget' })]))
  })

  it('keeps a normal status question read-only and gates costly contexts', () => {
    const intent = classifyMessagesPromptIntent({ content: 'What is the status of the project?' })
    expect(intent.profile).toBe('read_only')
    expect(intent.needsDelegation).toBe(false)
    expect(intent.needsCanvas).toBe(false)
    expect(intent.needsMailbox).toBe(false)
  })

  it('routes an email draft to the draft profile with only its scoped canvas/mailbox contexts', () => {
    const intent = classifyMessagesPromptIntent({ content: 'Draft an email to the client saying hello.' })
    expect(intent.profile).toBe('draft')
    expect(intent.needsDelegation).toBe(true)
    expect(intent.needsCanvas).toBe(true)
    expect(intent.needsMailbox).toBe(true)
    expect(intent.needsStudio).toBe(false)
  })

  it('does not promote a workspace status question to execution solely because it contains project language', () => {
    const intent = classifyMessagesPromptIntent({ content: 'What is the status of the project?' })
    expect(intent.profile).toBe('read_only')
    expect(intent.needsWorkspaceWriteContext).toBe(false)
  })

  it('truncates a block with maxTokens even when the profile limit has headroom and records capTokens', () => {
    const oversized = 'metadata-block '.repeat(5_000)
    const result = buildPromptBudget({
      profile: 'execution',
      limitTokens: 32_000,
      blocks: [
        { id: 'request', priority: 'critical', content: 'User request: keep this.' },
        { id: 'hermes_features', priority: 'normal', content: oversized, maxTokens: 100 },
      ],
    })

    const featuresLedger = result.ledger.blocks.find((block) => block.id === 'hermes_features')
    expect(featuresLedger).toEqual(expect.objectContaining({
      id: 'hermes_features',
      included: true,
      capTokens: 100,
    }))
    expect(featuresLedger!.includedTokens).toBeLessThanOrEqual(100)
    expect(featuresLedger!.includedTokens).toBeLessThan(featuresLedger!.inputTokens)
    expect(result.content).toContain('User request: keep this.')
    expect(result.content).toContain('…[prompt budget truncated]')
    expect(result.ledger.omitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hermes_features', reason: 'budget' }),
    ]))
    // Profile still has headroom — truncation is from the per-block cap, not the total budget.
    expect(result.ledger.inputTokens).toBeLessThan(result.ledger.limitTokens)
  })
})
