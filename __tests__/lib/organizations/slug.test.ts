import { clearOrgSlugCache, getOrgSlug } from '@/lib/organizations/slug'

function fakeOrgDb(rows: Record<string, Record<string, unknown> | undefined>) {
  return {
    collection(name: string) {
      if (name !== 'organizations') throw new Error(`unexpected collection ${name}`)
      return {
        doc(id: string) {
          return {
            async get() {
              const data = rows[id]
              return {
                exists: Boolean(data),
                data: () => data,
              }
            },
          }
        },
      }
    },
  }
}

describe('getOrgSlug', () => {
  beforeEach(() => {
    clearOrgSlugCache()
  })

  it('returns a runtime-safe slug and caches it', async () => {
    let reads = 0
    const db = {
      collection() {
        return {
          doc() {
            return {
              async get() {
                reads += 1
                return { exists: true, data: () => ({ slug: 'partners' }) }
              },
            }
          },
        }
      },
    }

    await expect(getOrgSlug('org_1', { db })).resolves.toBe('partners')
    await expect(getOrgSlug('org_1', { db })).resolves.toBe('partners')
    expect(reads).toBe(1)
  })

  it('rejects a missing organisation', async () => {
    await expect(getOrgSlug('missing', { db: fakeOrgDb({}) })).rejects.toThrow('org not found')
  })

  it('rejects an uppercase slug as not runtime-safe', async () => {
    await expect(
      getOrgSlug('org_1', { db: fakeOrgDb({ org_1: { slug: 'Partners' } }) }),
    ).rejects.toThrow('org slug is not runtime-safe')
  })
})
