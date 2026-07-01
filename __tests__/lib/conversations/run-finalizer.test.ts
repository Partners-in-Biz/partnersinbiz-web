const mockCollection = jest.fn()
const mockCollectionGroup = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollection(...args),
    collectionGroup: (...args: unknown[]) => mockCollectionGroup(...args),
  },
}))

jest.mock('@/lib/agents/team', () => ({
  getAgentDecryptedKey: jest.fn(),
}))

jest.mock('@/lib/hermes/server', () => ({
  HERMES_RUNS_COLLECTION: 'hermes_runs',
  callHermesJson: jest.fn(),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  CONVERSATIONS_COLLECTION: 'conversations',
  getConversation: jest.fn(),
  messagesCollection: jest.fn(),
  touchConversation: jest.fn(),
}))

import {
  extractHermesRunError,
  extractHermesRunOutput,
  extractOutputFromEvents,
  findPendingConversationRuns,
  normalizeHermesRunStatus,
} from '@/lib/conversations/run-finalizer'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('conversation run finalizer helpers', () => {
  it('normalizes direct and nested Hermes statuses', () => {
    expect(normalizeHermesRunStatus({ status: 'Completed' })).toBe('completed')
    expect(normalizeHermesRunStatus({ result: { state: 'RUNNING' } })).toBe('running')
    expect(normalizeHermesRunStatus({ data: { run_status: 'waiting_for_approval' } })).toBe('waiting_for_approval')
    expect(normalizeHermesRunStatus({})).toBe('unknown')
  })

  it('extracts text from common run output shapes', () => {
    expect(extractHermesRunOutput({ output: 'Done' })).toBe('Done')
    expect(extractHermesRunOutput({ output: { text: 'Nested done' } })).toBe('Nested done')
    expect(extractHermesRunOutput({ response: { output_text: 'OpenAI-style done' } })).toBe('OpenAI-style done')
    expect(extractHermesRunOutput({ output: [{ text: 'Part one' }, { content: 'Part two' }] })).toBe('Part one\nPart two')
  })

  it('extracts failed-run reasons without confusing normal content for errors', () => {
    expect(extractHermesRunError({ error: 'OOM killed' })).toBe('OOM killed')
    expect(extractHermesRunError({ details: { message: 'gateway restarted' } })).toBe('gateway restarted')
    expect(extractHermesRunError({ output: 'normal answer' })).toBeUndefined()
  })

  it('can rebuild output from streamed text events', () => {
    expect(extractOutputFromEvents([
      { event: 'message.delta', delta: 'Hello ' },
      { event: 'message.delta', delta: 'there' },
      { event: 'tool.call', text: 'ignored', error: true },
    ])).toBe('Hello there')
  })
})

describe('conversation run reconciliation discovery', () => {
  it('includes active unified-chat ledger rows even when their message is already completed', async () => {
    mockCollectionGroup.mockReturnValue({
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        })),
      })),
    })

    const completedMessageRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          status: 'completed',
          runId: 'run_gateway_completed',
          dispatchAgentId: 'pip',
          runDocId: 'ledger-started-1',
          richParts: [{ type: 'status', title: 'Already delivered', status: 'completed' }],
        }),
      }),
    }

    const where = jest.fn((field: string, op: string, value: unknown) => {
      if (field !== 'status' || op !== 'in' || !Array.isArray(value)) {
        throw new Error(`Unexpected hermes_runs query ${field} ${op}`)
      }
      return {
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'ledger-started-1',
                data: () => ({
                  status: 'started',
                  hermesRunId: 'run_gateway_completed',
                  metadata: {
                    source: 'pib-unified-chat',
                    conversationId: 'conv-1',
                    messageId: 'msg-1',
                    dispatchAgentId: 'pip',
                  },
                }),
              },
            ],
          }),
        })),
      }
    })

    mockCollection.mockImplementation((name: string) => {
      if (name === 'hermes_runs') return { where }
      if (name === 'conversations') {
        return {
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({ doc: jest.fn(() => completedMessageRef) })),
          })),
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })

    const candidates = await findPendingConversationRuns({ maxRuns: 10 })

    expect(candidates).toEqual([
      expect.objectContaining({
        convId: 'conv-1',
        msgId: 'msg-1',
        runId: 'run_gateway_completed',
        agentId: 'pip',
      }),
    ])
  })
})
