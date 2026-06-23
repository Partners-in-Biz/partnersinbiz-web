const mockListLiveInsightEntries = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/content/posts-firestore', () => ({
  listLiveInsightEntries: (...args: unknown[]) => mockListLiveInsightEntries(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollection(...args),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockListLiveInsightEntries.mockResolvedValue([
    { slug: 'admin-story', lastModified: '2026-06-23T10:00:00.000Z' },
    { slug: 'allowed-story', lastModified: '2026-06-22T10:00:00.000Z' },
  ])
  mockCollection.mockImplementation((collectionName: string) => {
    if (collectionName === 'admin_sitemap_config') {
      return {
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({
              excludedPaths: ['/pricing', '/insights/admin-story'],
            }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected collection ${collectionName}`)
  })
})

describe('public sitemap admin config wiring', () => {
  it('excludes admin-configured paths while keeping allowed live admin insights', async () => {
    const { default: sitemap } = await import('@/app/sitemap')

    const urls = (await sitemap()).map((entry) => entry.url)

    expect(urls).not.toContain('https://partnersinbiz.online/pricing')
    expect(urls).not.toContain('https://partnersinbiz.online/insights/admin-story')
    expect(urls).toContain('https://partnersinbiz.online/insights/allowed-story')
  })
})
