const getOrgDoc = jest.fn()
const where = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name !== 'organizations') throw new Error(`Unexpected collection ${name}`)
      return {
        doc: (id: string) => ({
          get: () => getOrgDoc(id),
        }),
        where,
      }
    }),
  },
}))

describe('organization slug/id resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('falls back to an organization document id when no slug matches', async () => {
    where.mockReturnValueOnce({
      limit: () => ({
        get: () => Promise.resolve({ docs: [] }),
      }),
    })
    getOrgDoc.mockResolvedValueOnce({ exists: true })

    const { resolveOrgIdBySlugOrId } = await import('@/lib/organizations/resolve-by-slug')

    await expect(resolveOrgIdBySlugOrId('org_123')).resolves.toBe('org_123')
  })

  it('prefers a slug match when one exists', async () => {
    where.mockReturnValueOnce({
      limit: () => ({
        get: () => Promise.resolve({ docs: [{ id: 'org_from_slug' }] }),
      }),
    })

    const { resolveOrgIdBySlugOrId } = await import('@/lib/organizations/resolve-by-slug')

    await expect(resolveOrgIdBySlugOrId('lumen-speeds')).resolves.toBe('org_from_slug')
    expect(getOrgDoc).not.toHaveBeenCalled()
  })
})
