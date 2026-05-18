import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockDocGet = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockGenerateText = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, doc: mockDoc },
}))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) =>
    (req: any, context?: any) => handler(req, { uid: 'ai-agent', role: 'ai' }, context),
}))
jest.mock('@/lib/ai/client', () => ({
  BRIEF_MODEL: 'anthropic/claude-haiku-4.5',
}))
jest.mock('ai', () => ({
  generateText: mockGenerateText,
}))

process.env.AI_API_KEY = 'test-key'

type Params = { params: Promise<{ id: string }> }

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue(query)
})

describe('GET /api/v1/ai/contact-brief/[id]', () => {
  it('returns 404 when contact not found', async () => {
    mockDoc.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) })
    const { GET } = await import('@/app/api/v1/ai/contact-brief/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/ai/contact-brief/c1')
    const ctx: Params = { params: Promise.resolve({ id: 'c1' }) }
    const res = await GET(req, ctx)
    expect(res.status).toBe(404)
  })

  it('returns AI-generated brief with resolved stage label from pipeline', async () => {
    // Contact doc
    const contactDocGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Alice Smith', email: 'alice@example.com', company: 'Acme', stage: 'proposal' }),
    })

    // Pipeline doc — called by adminDb.collection('pipelines').doc('pl-1')
    const pipelineDocGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        id: 'pl-1',
        stages: [
          { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 30 },
          { id: 'won',      label: 'Won',       kind: 'won',  order: 3, probability: 100 },
        ],
      }),
    })

    // mockDoc returns different mocks based on the path
    mockDoc.mockImplementation((path: string) => {
      if (path.startsWith('pipelines/')) return { get: pipelineDocGet }
      return { get: contactDocGet }
    })

    // collection().where().orderBy().limit().get() calls for activities, emails, deals
    mockGet
      .mockResolvedValueOnce({ docs: [
        { data: () => ({ type: 'email_sent', note: 'Sent intro email', createdAt: null }) },
      ]})
      .mockResolvedValueOnce({ docs: [
        { data: () => ({ subject: 'Intro', bodyText: 'Hello!', status: 'opened', createdAt: null }) },
      ]})
      .mockResolvedValueOnce({ docs: [
        { data: () => ({ title: 'Acme website', value: 5000, pipelineId: 'pl-1', stageId: 'proposal' }) },
      ]})

    mockGenerateText.mockResolvedValue({ text: 'Alice Smith is a prospect at Acme.' })

    jest.resetModules()
    const { GET } = await import('@/app/api/v1/ai/contact-brief/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/ai/contact-brief/c1')
    const ctx: Params = { params: Promise.resolve({ id: 'c1' }) }
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.brief).toBe('Alice Smith is a prospect at Acme.')
    expect(mockGenerateText).toHaveBeenCalledTimes(1)

    // The prompt should include "Proposal (open)" not a raw stageId
    const promptArg = mockGenerateText.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('Proposal (open)')
  })

  it('falls back to raw stageId when pipeline is not found', async () => {
    const contactDocGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Bob', email: 'bob@example.com', company: 'Foo' }),
    })
    const pipelineDocGet = jest.fn().mockResolvedValue({ exists: false })

    mockDoc.mockImplementation((path: string) => {
      if (path.startsWith('pipelines/')) return { get: pipelineDocGet }
      return { get: contactDocGet }
    })

    mockGet
      .mockResolvedValueOnce({ docs: [] }) // activities
      .mockResolvedValueOnce({ docs: [] }) // emails
      .mockResolvedValueOnce({ docs: [
        { data: () => ({ title: 'Bob deal', value: 1000, pipelineId: 'pl-missing', stageId: 'some_stage' }) },
      ]})

    mockGenerateText.mockResolvedValue({ text: 'Bob is a lead.' })

    jest.resetModules()
    const { GET } = await import('@/app/api/v1/ai/contact-brief/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/ai/contact-brief/bob')
    const ctx: Params = { params: Promise.resolve({ id: 'bob' }) }
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)

    // Prompt should fall back to raw stageId
    const promptArg = mockGenerateText.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('some_stage')
  })
})
