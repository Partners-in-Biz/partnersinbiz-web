const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockCollection = jest.fn()

export {}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue(query)
})

describe('agent memory entity resolution', () => {
  it('finds exact client/entity candidates before semantic retrieval', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [
        doc('org-john', { name: 'John Plumbing', slug: 'john-plumbing', type: 'client' }),
        doc('org-jane', { name: 'Jane Attorneys', slug: 'jane-attorneys', type: 'client' }),
      ]})
      .mockResolvedValueOnce({ docs: [
        doc('company-john', { orgId: 'pib-platform-owner', name: 'John Plumbing', website: 'https://john.example', deleted: false }),
      ]})
      .mockResolvedValueOnce({ docs: [
        doc('contact-john', { orgId: 'pib-platform-owner', name: 'John Smith', email: 'john@example.com', company: 'John Plumbing', deleted: false }),
      ]})

    const { resolveAgentEntities } = await import('@/lib/agent-memory/entity-resolution')
    const result = await resolveAgentEntities({
      query: 'get me the client called John Plumbing',
      orgId: 'pib-platform-owner',
      limit: 10,
    })

    expect(result.intent).toBe('entity_lookup')
    expect(result.entityCandidates.map((candidate) => candidate.id)).toEqual([
      'org-john',
      'company-john',
      'contact-john',
    ])
    expect(result.selectedEntity?.id).toBe('org-john')
    expect(result.selectedEntity?.matchReason).toBe('exact_name')
  })

  it('returns candidates without selecting when a lookup is ambiguous', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [
        doc('org-john-a', { name: 'John Electrical', slug: 'john-electrical', type: 'client' }),
        doc('org-john-b', { name: 'John Plumbing', slug: 'john-plumbing', type: 'client' }),
      ]})
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const { resolveAgentEntities } = await import('@/lib/agent-memory/entity-resolution')
    const result = await resolveAgentEntities({
      query: 'client called John',
      orgId: 'pib-platform-owner',
    })

    expect(result.entityCandidates).toHaveLength(2)
    expect(result.selectedEntity).toBeNull()
    expect(result.nextActions).toContain('Choose one of the matching entities before taking action.')
  })

  it('filters organization candidates to the allowed tenant scope', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [
        doc('org-allowed', { name: 'John Allowed', slug: 'john-allowed', type: 'client' }),
        doc('org-blocked', { name: 'John Blocked', slug: 'john-blocked', type: 'client' }),
      ]})
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const { resolveAgentEntities } = await import('@/lib/agent-memory/entity-resolution')
    const result = await resolveAgentEntities({
      query: 'John',
      orgId: 'org-allowed',
      allowedOrganizationIds: ['org-allowed'],
    })

    expect(result.entityCandidates.map((candidate) => candidate.id)).toEqual(['org-allowed'])
    expect(result.entityCandidates).not.toContainEqual(expect.objectContaining({ id: 'org-blocked' }))
  })
})
