const mockEmbed = jest.fn()
const mockFindNearest = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockCollection = jest.fn()

export {}

jest.mock('ai', () => ({
  embed: (input: unknown) => mockEmbed(input),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })
  const vectorQuery = { get: mockGet }
  const query = { where: mockWhere, findNearest: mockFindNearest }
  mockCollection.mockReturnValue(query)
  mockWhere.mockReturnValue(query)
  mockFindNearest.mockReturnValue(vectorQuery)
})

describe('agent memory retrieval', () => {
  it('prefilters vector retrieval by orgId before findNearest', async () => {
    mockGet.mockResolvedValue({ docs: [
      {
        id: 'chunk-1',
        data: () => ({
          orgId: 'org-1',
          sourceType: 'research_item',
          sourceId: 'research-1',
          title: 'Client research',
          text: 'Full evidence',
          summary: 'Evidence summary',
          sensitivity: 'internal',
          entityRefs: [{ type: 'organization', id: 'org-1' }],
        }),
      },
    ]})

    const { retrieveAgentMemory } = await import('@/lib/agent-memory/retrieval')
    const result = await retrieveAgentMemory({
      query: 'What do we know about John?',
      orgId: 'org-1',
      limit: 3,
      user: { uid: 'agent:pip', role: 'ai', agentId: 'pip', authKind: 'agent_api_key' },
    })

    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockFindNearest).toHaveBeenCalledWith(expect.objectContaining({
      vectorField: 'embedding',
      limit: expect.any(Number),
      distanceMeasure: 'COSINE',
    }))
    expect(result.memory[0]).toMatchObject({ id: 'chunk-1', text: 'Full evidence' })
  })

  it('redacts sensitive memory when the agent lacks source permission', async () => {
    mockGet.mockResolvedValue({ docs: [
      {
        id: 'mailbox-1',
        data: () => ({
          orgId: 'org-1',
          sourceType: 'mailbox_message',
          sourceId: 'msg-1',
          title: 'Client email',
          text: 'Sensitive inbox text',
          summary: 'Inbox summary',
          sensitivity: 'sensitive',
          entityRefs: [],
        }),
      },
    ]})

    const { retrieveAgentMemory } = await import('@/lib/agent-memory/retrieval')
    const result = await retrieveAgentMemory({
      query: 'latest email',
      orgId: 'org-1',
      user: { uid: 'agent:sage', role: 'ai', agentId: 'sage', authKind: 'agent_api_key', permissions: [] },
    })

    expect(result.memory[0].text).toContain('Redacted sensitive memory')
    expect(result.memory[0].redacted).toBe(true)
  })

  it('redacts allow-listed chunks when the agent is not delegated', async () => {
    mockGet.mockResolvedValue({ docs: [
      {
        id: 'research-allow-list',
        data: () => ({
          orgId: 'org-1',
          sourceType: 'research_item',
          sourceId: 'research-allow',
          title: 'Private research',
          text: 'Only one agent should read this.',
          sensitivity: 'internal',
          allowedAgentIds: ['other-agent'],
          entityRefs: [],
        }),
      },
    ]})

    const { retrieveAgentMemory } = await import('@/lib/agent-memory/retrieval')
    const result = await retrieveAgentMemory({
      query: 'private research',
      orgId: 'org-1',
      user: { uid: 'agent:pip', role: 'ai', agentId: 'pip', authKind: 'agent_api_key' },
    })

    expect(result.memory[0].text).toContain('Redacted sensitive memory')
    expect(result.memory[0].redacted).toBe(true)
  })
})
