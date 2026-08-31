import {
  DEFAULT_COMPRESS_KEEP_TURNS,
  HISTORY_WINDOW,
  buildCompressionInputBlock,
  buildCompressionTaskPromptBlock,
  buildContextReport,
  buildContextUsageSnapshot,
  buildConversationHistoryBlock,
  computeCompressionPlan,
  estimateTokens,
  parseCompressArgs,
  type CompressibleMessage,
} from '@/lib/chat/context-compression'

function msg(id: string, role: 'user' | 'assistant', content: string, extra: Partial<CompressibleMessage> = {}): CompressibleMessage {
  return {
    id,
    role,
    content,
    authorDisplayName: role === 'user' ? 'Peet' : 'Pip',
    authorId: role === 'user' ? 'user-1' : 'pip',
    ...extra,
  }
}

/** Build an ascending conversation: user/assistant pairs, ids m1..mN. */
function conversation(pairs: number, content = (index: number, role: string) => `${role}-${index}`): CompressibleMessage[] {
  const messages: CompressibleMessage[] = []
  for (let index = 1; index <= pairs; index += 1) {
    messages.push(msg(`m${index * 2 - 1}`, 'user', content(index, 'user')))
    messages.push(msg(`m${index * 2}`, 'assistant', content(index, 'assistant')))
  }
  return messages
}

describe('context-compression', () => {
  describe('parseCompressArgs', () => {
    it('defaults to compress with 5 kept exchanges', () => {
      expect(parseCompressArgs('')).toEqual({ action: 'compress', keepTurns: DEFAULT_COMPRESS_KEEP_TURNS })
    })

    it('parses here N', () => {
      expect(parseCompressArgs('here 3')).toEqual({ action: 'compress', keepTurns: 3 })
    })

    it('clamps keep turns to 1..30', () => {
      expect(parseCompressArgs('here 0')).toEqual({ action: 'compress', keepTurns: 1 })
      expect(parseCompressArgs('here 99')).toEqual({ action: 'compress', keepTurns: 30 })
      expect(parseCompressArgs('here -2')).toEqual({ action: 'compress', keepTurns: 1 })
    })

    it('parses focus topic (including multi-word)', () => {
      expect(parseCompressArgs('focus authentication')).toEqual({
        action: 'compress',
        keepTurns: DEFAULT_COMPRESS_KEEP_TURNS,
        focusTopic: 'authentication',
      })
      expect(parseCompressArgs('here 4 focus billing flow')).toEqual({
        action: 'compress',
        keepTurns: 4,
        focusTopic: 'billing flow',
      })
    })

    it('recognizes status and clear', () => {
      expect(parseCompressArgs('status')).toEqual({ action: 'status', keepTurns: DEFAULT_COMPRESS_KEEP_TURNS })
      expect(parseCompressArgs('show')).toEqual({ action: 'status', keepTurns: DEFAULT_COMPRESS_KEEP_TURNS })
      expect(parseCompressArgs('clear')).toEqual({ action: 'clear', keepTurns: DEFAULT_COMPRESS_KEEP_TURNS })
    })
  })

  describe('computeCompressionPlan', () => {
    it('keeps the last N exchanges and cuts before them', () => {
      const messages = conversation(10)
      // Current user message m21 is appended by dispatch; simulate it.
      const withCurrent = [...messages, msg('m21', 'user', 'user-11')]
      const plan = computeCompressionPlan(withCurrent, 'm21', 'here 3')
      expect(plan).not.toBeNull()
      // Last 3 real user exchanges: m15/m16, m17/m18, m19/m20 (the /compress
      // message itself is not counted). Kept window starts at m15.
      expect(plan!.compressedThroughMessageId).toBe('m14')
      expect(plan!.keepTurns).toBe(3)
    })

    it('returns null when there is nothing old enough to compress', () => {
      const messages = conversation(2)
      const withCurrent = [...messages, msg('m5', 'user', 'user-3')]
      expect(computeCompressionPlan(withCurrent, 'm5', 'here 5')).toBeNull()
    })

    it('returns null for status/clear actions', () => {
      expect(computeCompressionPlan(conversation(10), 'm21', 'status')).toBeNull()
      expect(computeCompressionPlan(conversation(10), 'm21', 'clear')).toBeNull()
    })

    it('carries focus topic through the plan', () => {
      const messages = conversation(10)
      const plan = computeCompressionPlan([...messages, msg('m21', 'user', 'user-11')], 'm21', 'here 2 focus auth')
      expect(plan?.focusTopic).toBe('auth')
      expect(plan?.keepTurns).toBe(2)
    })
  })

  describe('buildCompressionInputBlock', () => {
    it('includes only the older messages up to the cut and excludes the current message', () => {
      const messages = conversation(6)
      const withCurrent = [...messages, msg('m13', 'user', 'user-7')]
      const plan = computeCompressionPlan(withCurrent, 'm13', 'here 2')!
      const block = buildCompressionInputBlock(withCurrent, 'm13', plan)
      expect(block).toContain('[Conversation context to compress')
      expect(block).toContain('user-1')
      expect(block).toContain('assistant-4')
      // Recent kept exchanges (m9/m10/m11/m12) must NOT appear.
      expect(block).not.toContain('user-5')
      expect(block).not.toContain('assistant-6')
      // Current message excluded.
      expect(block).not.toContain('user-7')
    })

    it('is empty when nothing sits before the cut (current message is the only candidate)', () => {
      const messages = conversation(1)
      // m1 is the current message and also the cut → nothing left to summarize.
      expect(buildCompressionInputBlock(messages, 'm1', { keepTurns: 1, compressedThroughMessageId: 'm1' })).toBe('')
      // Unknown cut id → nothing before it.
      expect(buildCompressionInputBlock(messages, 'm1', { keepTurns: 1, compressedThroughMessageId: 'm0' })).toBe('')
    })
  })

  describe('buildCompressionTaskPromptBlock', () => {
    it('instructs the agent to reply with only the summary and preserves focus topic', () => {
      const block = buildCompressionTaskPromptBlock({ keepTurns: 5, compressedThroughMessageId: 'm10', focusTopic: 'auth' })
      expect(block).toContain('[Context compression task]')
      expect(block).toContain('Reply with ONLY the summary text')
      expect(block).toContain('focus topic "auth"')
    })
  })

  describe('buildConversationHistoryBlock', () => {
    it('behaves like the old fixed window when no compression exists', () => {
      const messages = conversation(40)
      const block = buildConversationHistoryBlock(messages, '', null)
      expect(block).toContain('[Recent conversation history')
      expect(block).toContain('user-26')
      expect(block).toContain('user-40')
      // Window is 30 messages (15 exchanges), so exchange 1 must be dropped.
      expect(block).not.toContain('user-1')
    })

    it('injects the summary and keeps only messages after the cut', () => {
      const messages = conversation(10)
      const compression = {
        summary: 'SUMMARY: earlier decisions on billing and auth.',
        compressedThroughMessageId: 'm10',
        keepTurns: 5,
        createdAt: '2026-08-06T00:00:00.000Z',
      }
      const block = buildConversationHistoryBlock(messages, '', compression)
      expect(block).toContain('[Compressed earlier context — /compress here 5]')
      expect(block).toContain('SUMMARY: earlier decisions on billing and auth.')
      expect(block).not.toMatch(/user-1\b/)
      expect(block).not.toMatch(/assistant-5\b/)
      expect(block).toContain('user-6')
      expect(block).toContain('assistant-10')
    })

    it('redacts stale pib_dlg_ tokens so a cached conversation blob cannot reuse them', () => {
      const messages = [
        msg('m1', 'user', 'Please read the inbox'),
        msg('m2', 'assistant', 'Authorization: Bearer pib_dlg_staleFromEarlierTurnABC123 and leftover pib_dlg_anotherOldToken99'),
        msg('m3', 'user', 'now'),
      ]
      const block = buildConversationHistoryBlock(messages, 'm3', {
        summary: 'Earlier auth used pib_dlg_compressedHistoryToken',
        compressedThroughMessageId: 'missing',
        keepTurns: 5,
        createdAt: '2026-08-06T00:00:00.000Z',
      })
      expect(block).not.toContain('pib_dlg_staleFromEarlierTurnABC123')
      expect(block).not.toContain('pib_dlg_anotherOldToken99')
      expect(block).not.toContain('pib_dlg_compressedHistoryToken')
      expect(block).toContain('pib_dlg_[redacted]')
      expect(block).toContain('Authorization: Bearer [redacted]')
    })

    it('keeps the whole thread when the cut is before everything', () => {
      const messages = conversation(4)
      const compression = {
        summary: 'SUMMARY',
        compressedThroughMessageId: 'm0', // before all messages → nothing compressed
        keepTurns: 2,
        createdAt: '2026-08-06T00:00:00.000Z',
      }
      const block = buildConversationHistoryBlock(messages, '', compression)
      expect(block).toContain('user-1')
      expect(block).toContain('assistant-4')
    })
  })

  describe('estimateTokens + snapshot + report', () => {
    it('estimates tokens as chars/4', () => {
      expect(estimateTokens('')).toBe(0)
      expect(estimateTokens('abcd')).toBe(1)
      expect(estimateTokens('abcdefgh')).toBe(2)
    })

    it('builds a usage snapshot with counts and compression state', () => {
      const messages = conversation(6)
      const snapshot = buildContextUsageSnapshot({
        messages,
        conversation: {
          contextCompression: {
            summary: 'S',
            compressedThroughMessageId: 'm4',
            keepTurns: 3,
            createdAt: '2026-08-06T00:00:00.000Z',
          },
          model: 'deepseek/deepseek-v4-flash',
          provider: 'deepseek',
        },
      })
      expect(snapshot.totalMessages).toBe(12)
      expect(snapshot.userMessages).toBe(6)
      expect(snapshot.assistantMessages).toBe(6)
      expect(snapshot.exchanges).toBe(6)
      expect(snapshot.historyWindow).toBe(HISTORY_WINDOW)
      expect(snapshot.historyBlockTokens).toBeGreaterThan(0)
      expect(snapshot.compression?.keepTurns).toBe(3)
      expect(snapshot.compressedMessages).toBe(4)
      expect(snapshot.model).toBe('deepseek/deepseek-v4-flash (deepseek)')
    })

    it('report mentions usage and compression', () => {
      const snapshot = buildContextUsageSnapshot({
        messages: conversation(3),
        conversation: { contextCompression: null, model: null, provider: null },
      })
      const report = buildContextReport(snapshot)
      expect(report).toContain('**Context usage — this conversation**')
      expect(report).toContain('Exchanges: 3')
      expect(report).toContain('Compression: none yet')
      expect(report).toContain('/compress here 5')
    })
  })
})
