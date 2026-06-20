import { NextRequest } from 'next/server'
import type { ChatEvent } from '@/lib/hermes/types'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai' }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockGetConversation = jest.fn()
const mockMessageGet = jest.fn()
const mockMessageUpdate = jest.fn()
const mockTouchConversation = jest.fn()
const mockCallHermesJson = jest.fn()
const mockGetAgentDecryptedKey = jest.fn()

let mockUser: MockUser = { uid: 'client-1', role: 'client' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  messagesCollection: () => ({ doc: () => ({ get: mockMessageGet, update: mockMessageUpdate }) }),
  touchConversation: (...args: unknown[]) => mockTouchConversation(...args),
}))

jest.mock('@/lib/hermes/server', () => ({
  HERMES_RUNS_COLLECTION: 'hermes_runs',
  callHermesJson: (...args: unknown[]) => mockCallHermesJson(...args),
}))

jest.mock('@/lib/agents/team', () => ({
  getAgentDecryptedKey: (...args: unknown[]) => mockGetAgentDecryptedKey(...args),
}))

jest.mock('@/lib/api/response', () => ({
  apiError: (msg: string, status = 400, extra?: unknown) =>
    new Response(JSON.stringify({ error: msg, ...(extra ? { details: extra } : {}) }), { status }),
  apiSuccess: (data: unknown) =>
    new Response(JSON.stringify({ data }), { status: 200 }),
}))

const baseConv = { id: 'conv-1', orgId: 'org-1', participantUids: ['client-1'] }

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/messages/msg-1/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function callFinalize(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/[msgId]/finalize/route')
  return POST(
    makeRequest(body),
    { params: Promise.resolve({ convId: 'conv-1', msgId: 'msg-1' }) },
  )
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client' }
  mockGetConversation.mockResolvedValue(baseConv)
  mockMessageGet.mockResolvedValue({ exists: true, data: () => ({}) })
  mockMessageUpdate.mockResolvedValue(undefined)
  mockTouchConversation.mockResolvedValue(undefined)
  mockGetAgentDecryptedKey.mockResolvedValue('secret')
  mockCollection.mockImplementation((name: string) => {
    if (name === 'agent_team') {
      return {
        doc: (agentId: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({ agentId, enabled: true, baseUrl: 'https://hermes.example.com' }),
          }),
        }),
      }
    }
    if (name === 'hermes_runs') {
      return {
        where: () => ({
          limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
        }),
        doc: () => ({ set: jest.fn().mockResolvedValue(undefined) }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('POST /api/v1/conversations/[convId]/messages/[msgId]/finalize', () => {
  it('treats interrupted agent runs as terminal and preserves streamed events', async () => {
    const events: ChatEvent[] = [{ event: 'run.interrupted', timestamp: 1000 }]
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: { status: 'interrupted', error: 'gateway restarted while run was active' },
    })

    const res = await callFinalize({ runId: 'run-1', agentId: 'pip', events })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('failed')
    expect(mockMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      content: 'gateway restarted while run was active',
      status: 'failed',
      error: 'gateway restarted while run was active',
      runId: 'run-1',
      events,
    }))
    expect(mockTouchConversation).toHaveBeenCalledWith(
      'conv-1',
      '[run interrupted] gateway restarted while run was active',
      'assistant',
    )
  })

  it('marks missing gateway runs as interrupted/lost instead of asking users to resend blindly', async () => {
    const events: ChatEvent[] = [{ event: 'assistant.text_delta', delta: 'partial', timestamp: 1000 }]
    mockCallHermesJson.mockResolvedValue({
      response: { ok: false, status: 404 },
      data: { detail: 'run not found' },
    })

    const res = await callFinalize({ runId: 'run-missing', agentId: 'pip', events })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('failed')
    expect(body.data.error).toContain('agent gateway lost this run')
    expect(mockMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      runId: 'run-missing',
      events,
      error: expect.stringContaining('agent gateway lost this run'),
    }))
  })

  it('persists completed Hermes rich parts and UI actions alongside fallback text', async () => {
    const events: ChatEvent[] = [
      {
        event: 'message.rich',
        timestamp: 1000,
        richParts: [
          { type: 'status', title: 'Live checks passed', status: 'completed', body: 'Preview is ready.' },
        ],
        uiActions: [
          { id: 'open-preview', type: 'open', label: 'Open preview', url: 'https://preview.example.com' },
        ],
      },
    ]
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: {
        status: 'completed',
        output: {
          text: 'Ready for review.',
          rich_parts: [
            { type: 'markdown', content: '### Ready\n- Preview deployed' },
            {
              type: 'table',
              columns: ['Check', 'Result'],
              rows: [['Build', 'Passed']],
            },
          ],
          ui_actions: [
            { id: 'copy-summary', type: 'copy', label: 'Copy summary', value: 'Ready for review.' },
          ],
        },
      },
    })

    const res = await callFinalize({ runId: 'run-rich', agentId: 'pip', events })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('completed')
    expect(mockMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Ready for review.',
      status: 'completed',
      runId: 'run-rich',
      events,
      richParts: [
        { type: 'markdown', content: '### Ready\n- Preview deployed' },
        {
          type: 'table',
          columns: ['Check', 'Result'],
          rows: [['Build', 'Passed']],
        },
        { type: 'status', title: 'Live checks passed', status: 'completed', body: 'Preview is ready.' },
      ],
      uiActions: [
        { id: 'copy-summary', type: 'copy', label: 'Copy summary', value: 'Ready for review.' },
        { id: 'open-preview', type: 'open', label: 'Open preview', url: 'https://preview.example.com' },
      ],
    }))
  })

  it('preserves generated video outputs from Hermes artifacts as rich video parts', async () => {
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: {
        status: 'completed',
        output: {
          text: 'Generated video ready for review.',
          artifact: {
            type: 'video',
            url: 'https://cdn.example.com/higgsfield/final-render.mp4',
            name: 'Higgsfield final render',
            mimeType: 'video/mp4',
          },
        },
      },
    })

    const res = await callFinalize({ runId: 'run-generated-video', agentId: 'maya', events: [] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('completed')
    expect(mockMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Generated video ready for review.',
      status: 'completed',
      runId: 'run-generated-video',
      richParts: [
        {
          type: 'video',
          url: 'https://cdn.example.com/higgsfield/final-render.mp4',
          name: 'Higgsfield final render',
          mimeType: 'video/mp4',
        },
      ],
    }))
  })

  it('extracts rich parts from JSON text output instead of persisting raw JSON in the chat bubble', async () => {
    const richJsonText = JSON.stringify({
      rich_parts: [
        { type: 'markdown', content: '### PIB rich chat smoke test\nThis should render as markdown.' },
        {
          type: 'status_card',
          title: 'Rich chat contract smoke test',
          status: 'ready_for_review',
          body: 'No external action was performed.',
        },
      ],
      ui_actions: [
        { id: 'copy-summary', type: 'copy', label: 'Copy summary', value: 'PIB rich chat smoke test' },
      ],
    }, null, 2)

    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: {
        status: 'completed',
        output: {
          content: richJsonText,
        },
      },
    })

    const res = await callFinalize({ runId: 'run-json-rich', agentId: 'pip', events: [] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('completed')
    expect(mockMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      content: '',
      status: 'completed',
      runId: 'run-json-rich',
      richParts: [
        { type: 'markdown', content: '### PIB rich chat smoke test\nThis should render as markdown.' },
        {
          type: 'status',
          title: 'Rich chat contract smoke test',
          status: 'ready_for_review',
          body: 'No external action was performed.',
        },
      ],
      uiActions: [
        { id: 'copy-summary', type: 'copy', label: 'Copy summary', value: 'PIB rich chat smoke test' },
      ],
    }))
    expect(mockTouchConversation).toHaveBeenCalledWith(
      'conv-1',
      expect.stringContaining('PIB rich chat smoke test'),
      'assistant',
    )
    expect(mockTouchConversation).not.toHaveBeenCalledWith(
      'conv-1',
      expect.stringContaining('"rich_parts"'),
      'assistant',
    )
  })

  it('extracts rich parts from streamed JSON deltas when the run has no output field', async () => {
    const richJsonText = JSON.stringify({
      rich_parts: [
        { type: 'markdown', content: '### Streamed rich payload\nThis should be stored as rich content.' },
        {
          type: 'table',
          columns: ['Check', 'Status'],
          rows: [['Stream parser', 'Ready']],
        },
      ],
      ui_actions: [
        { id: 'copy-stream', type: 'copy', label: 'Copy streamed summary', value: 'Streamed rich payload' },
      ],
    }, null, 2)
    const events: ChatEvent[] = [
      { event: 'assistant.text_delta', delta: richJsonText.slice(0, 80), timestamp: 1000 },
      { event: 'assistant.text_delta', delta: richJsonText.slice(80), timestamp: 1001 },
    ]

    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: { status: 'completed' },
    })

    const res = await callFinalize({ runId: 'run-streamed-json-rich', agentId: 'pip', events })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('completed')
    expect(mockMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      content: '',
      status: 'completed',
      runId: 'run-streamed-json-rich',
      events,
      richParts: [
        { type: 'markdown', content: '### Streamed rich payload\nThis should be stored as rich content.' },
        {
          type: 'table',
          columns: ['Check', 'Status'],
          rows: [['Stream parser', 'Ready']],
        },
      ],
      uiActions: [
        { id: 'copy-stream', type: 'copy', label: 'Copy streamed summary', value: 'Streamed rich payload' },
      ],
    }))
  })
})
