const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollection(...args),
  },
}))

type MockDoc = { id: string; data: () => Record<string, unknown> }

function makeSnap(docs: MockDoc[]) {
  return {
    empty: docs.length === 0,
    docs,
  }
}

function makeDoc(id: string, data: Record<string, unknown>): MockDoc {
  return { id, data: () => data }
}

function makeQuery(collectionName: string, filters: Array<{ field: string; value: unknown }> = []) {
  return {
    where(field: string, _op: string, value: unknown) {
      return makeQuery(collectionName, [...filters, { field, value }])
    },
    limit(_n: number) {
      return makeQuery(collectionName, filters)
    },
    async get() {
      if (collectionName === 'seo_content') {
        const slug = filters.find((f) => f.field === 'slug')?.value
        const status = filters.find((f) => f.field === 'status')?.value
        if (slug === 'campaign-live' && status === 'live') {
          return makeSnap([
            makeDoc('seo-live-1', {
              slug: 'campaign-live',
              status: 'live',
              title: 'Campaign Live',
              category: 'Case Studies',
              publishDate: '2026-06-20',
              draftPostId: 'draft-live-1',
              heroImageUrl: '/images/campaign-live.png',
            }),
          ])
        }
        if (!slug && status === 'live') {
          return makeSnap([
            makeDoc('seo-live-1', {
              slug: 'campaign-live',
              status: 'live',
              title: 'Campaign Live',
              category: 'Case Studies',
              publishDate: '2026-06-20',
              draftPostId: 'draft-live-1',
              heroImageUrl: '/images/campaign-live.png',
            }),
          ])
        }
        return makeSnap([])
      }

      if (collectionName === 'admin_seo_articles') {
        const slug = filters.find((f) => f.field === 'slug')?.value
        const status = filters.find((f) => f.field === 'status')?.value
        if (slug === 'admin-story' && status === 'published') {
          return makeSnap([
            makeDoc('admin-1', {
              slug: 'admin-story',
              status: 'published',
              title: 'Admin Story',
              metaDescription: 'Admin story summary',
              keyword: 'SEO',
              updatedAt: '2026-06-23T10:00:00.000Z',
              publishedAt: '2026-06-23T09:00:00.000Z',
              body: [
                { id: 'h1', type: 'heading', text: 'Admin heading', level: 2 },
                { id: 'p1', type: 'paragraph', text: 'Paragraph body copy.' },
                { id: 'l1', type: 'list', items: ['First', 'Second'] },
              ],
            }),
          ])
        }
        if (status === 'published') {
          return makeSnap([
            makeDoc('admin-1', {
              slug: 'admin-story',
              status: 'published',
              title: 'Admin Story',
              metaDescription: 'Admin story summary',
              keyword: 'SEO',
              updatedAt: '2026-06-23T10:00:00.000Z',
              publishedAt: '2026-06-23T09:00:00.000Z',
              body: [
                { id: 'h1', type: 'heading', text: 'Admin heading', level: 2 },
                { id: 'p1', type: 'paragraph', text: 'Paragraph body copy.' },
              ],
            }),
          ])
        }
        return makeSnap([])
      }

      return makeSnap([])
    },
    doc(id: string) {
      return {
        async get() {
          if (collectionName === 'seo_drafts' && id === 'draft-live-1') {
            return {
              exists: true,
              data: () => ({
                body: 'Campaign body',
                wordCount: 440,
                metaDescription: 'Campaign live description',
              }),
            }
          }
          return { exists: false, data: () => ({}) }
        },
      }
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockImplementation((collectionName: string) => makeQuery(collectionName))
})

describe('posts Firestore bridge', () => {
  it('resolves a published admin SEO article as a public insight post', async () => {
    const { getFirestorePostBySlug } = await import('@/lib/content/posts-firestore')

    const post = await getFirestorePostBySlug('admin-story')

    expect(post).toMatchObject({
      slug: 'admin-story',
      title: 'Admin Story',
      description: 'Admin story summary',
      category: 'Industry POV',
      datePublished: '2026-06-23',
    })
    expect(post?.body).toContain('## Admin heading')
    expect(post?.body).toContain('Paragraph body copy.')
    expect(post?.body).toContain('- First')
  })

  it('includes published admin SEO slugs alongside live seo_content slugs', async () => {
    const { listLiveSlugs, listLiveInsightEntries } = await import('@/lib/content/posts-firestore')

    await expect(listLiveSlugs()).resolves.toEqual(
      expect.arrayContaining(['campaign-live', 'admin-story']),
    )

    await expect(listLiveInsightEntries()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'campaign-live' }),
        expect.objectContaining({ slug: 'admin-story', lastModified: '2026-06-23T10:00:00.000Z' }),
      ]),
    )
  })
})
