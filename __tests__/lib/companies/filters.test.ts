// __tests__/lib/companies/filters.test.ts

const mockWhere = jest.fn().mockReturnThis()
const mockOrderBy = jest.fn().mockReturnThis()
const mockLimit = jest.fn().mockReturnThis()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

// eslint-disable-next-line import/first
import { buildCompanyQuery, applyPostFilterSearch } from '@/lib/companies/filters'

describe('buildCompanyQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockWhere.mockReturnThis()
    mockOrderBy.mockReturnThis()
    mockLimit.mockReturnThis()
    mockCollection.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy, limit: mockLimit })
  })

  it('applies orgId filter always', () => {
    buildCompanyQuery('org-a', {})
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-a')
  })

  it('excludes soft-deleted by default (where deleted != true)', () => {
    buildCompanyQuery('org-a', {})
    expect(mockWhere).toHaveBeenCalledWith('deleted', '!=', true)
    // Must orderBy('deleted') first when filtering by deleted inequality
    expect(mockOrderBy).toHaveBeenCalledWith('deleted')
  })

  it('does NOT apply soft-delete filter when includeDeleted: true', () => {
    buildCompanyQuery('org-a', {}, { includeDeleted: true })
    expect(mockWhere).not.toHaveBeenCalledWith('deleted', '!=', true)
    expect(mockOrderBy).not.toHaveBeenCalledWith('deleted')
  })

  it('applies industry filter', () => {
    buildCompanyQuery('org-a', { industry: 'SaaS' })
    expect(mockWhere).toHaveBeenCalledWith('industry', '==', 'SaaS')
  })

  it('applies tags filter as array-contains-any', () => {
    buildCompanyQuery('org-a', { tags: ['enterprise', 'partner'] })
    expect(mockWhere).toHaveBeenCalledWith('tags', 'array-contains-any', ['enterprise', 'partner'])
  })

  it('clamps tags to max 10', () => {
    const elevenTags = Array.from({ length: 11 }, (_, i) => `tag${i}`)
    buildCompanyQuery('org-a', { tags: elevenTags })
    expect(mockWhere).toHaveBeenCalledWith('tags', 'array-contains-any', elevenTags.slice(0, 10))
  })

  it('applies default orderBy createdAt desc', () => {
    buildCompanyQuery('org-a', {})
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc')
  })

  it('applies limit + max cap 200', () => {
    buildCompanyQuery('org-a', { limit: 500 })
    expect(mockLimit).toHaveBeenCalledWith(200)
  })
})

describe('applyPostFilterSearch', () => {
  it('case-insensitively matches name', () => {
    const cos = [{ name: 'ACME', domain: 'acme.com' }, { name: 'Globex', domain: 'globex.com' }]
    expect(applyPostFilterSearch(cos as never, 'acm')).toEqual([cos[0]])
  })
  it('also matches domain + website', () => {
    const cos = [{ name: 'X', domain: 'foo.com', website: 'https://wow.io' }]
    expect(applyPostFilterSearch(cos as never, 'wow')).toEqual(cos)
  })
  it('also matches industry', () => {
    const cos = [{ name: 'X', domain: 'foo.com', industry: 'SaaS Analytics' }]
    expect(applyPostFilterSearch(cos as never, 'analytics')).toEqual(cos)
  })
  it('returns all when search empty', () => {
    const cos = [{ name: 'A' }, { name: 'B' }] as never
    expect(applyPostFilterSearch(cos, '')).toEqual(cos)
  })
})
