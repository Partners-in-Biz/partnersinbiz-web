jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {},
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
  normalizeHermesRunStatus,
} from '@/lib/conversations/run-finalizer'

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
