import {
  createCreative,
  getCreative,
  listCreatives,
  updateCreative,
  archiveCreative,
  setPlatformRef,
} from '@/lib/ads/creatives/store'
import type { AdPlatform, PlatformCreativeRef } from '@/lib/ads/types'

// Mock the firebase admin module to avoid live Firestore in tests
jest.mock('@/lib/firebase/admin', () => {
  const docs = new Map<string, Record<string, unknown>>()

  function makeQuery(path: string, filters: Array<[string, string, unknown]> = []) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(path, [...filters, [field, op, value]]),
      orderBy: (_field: string, _dir?: string) => makeQuery(path, filters),
      get: async () => ({
        docs: Array.from(docs.entries())
          .filter(([k]) => k.startsWith(`${path}/`))
          .filter(([, data]) =>
            filters.every(([field, op, value]) => {
              if (op !== '==') return true
              return (data as Record<string, unknown>)[field] === value
            }),
          )
          .map(([k, v]) => ({ id: k.replace(`${path}/`, ''), data: () => v })),
      }),
    }
  }

  const collection = (path: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        exists: docs.has(`${path}/${id}`),
        id,
        data: () => docs.get(`${path}/${id}`),
      }),
      set: async (data: Record<string, unknown>) => {
        docs.set(`${path}/${id}`, { ...data })
      },
      update: async (patch: Record<string, unknown>) => {
        const cur = docs.get(`${path}/${id}`) ?? {}
        docs.set(`${path}/${id}`, { ...cur, ...patch })
      },
      delete: async () => {
        docs.delete(`${path}/${id}`)
      },
    }),
    where: (field: string, op: string, value: unknown) => makeQuery(path, [[field, op, value]]),
  })

  return {
    adminDb: { collection },
    _docs: docs,
  }
})

const BASE_INPUT = {
  type: 'image' as const,
  name: 'Hero Banner',
  storagePath: 'orgs/org_1/ad_creatives/crv_1/source.jpg',
  sourceUrl: 'https://storage.googleapis.com/bucket/orgs/org_1/ad_creatives/crv_1/source.jpg',
  fileSize: 250000,
  mimeType: 'image/jpeg',
  status: 'UPLOADING' as const,
}

describe('creatives store', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
    _docs.clear()
  })

  it('roundtrips create/get with generated crv_ id and defaults', async () => {
    const creative = await createCreative({
      orgId: 'org_1',
      createdBy: 'user_abc',
      input: BASE_INPUT,
    })

    expect(creative.id).toMatch(/^crv_[0-9a-f]{16}$/)
    expect(creative.orgId).toBe('org_1')
    expect(creative.createdBy).toBe('user_abc')
    expect(creative.platformRefs).toEqual({})
    expect(creative.createdAt).toBeDefined()
    expect(creative.updatedAt).toBeDefined()

    const fetched = await getCreative(creative.id)
    expect(fetched?.id).toBe(creative.id)
    expect(fetched?.name).toBe('Hero Banner')
    expect(fetched?.type).toBe('image')
  })

  it('listCreatives filters by orgId and type', async () => {
    await createCreative({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, type: 'image' } })
    await createCreative({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, type: 'video', mimeType: 'video/mp4' } })
    await createCreative({ orgId: 'org_2', createdBy: 'u2', input: BASE_INPUT })

    const images = await listCreatives({ orgId: 'org_1', type: 'image' })
    expect(images).toHaveLength(1)
    expect(images[0].type).toBe('image')

    const all = await listCreatives({ orgId: 'org_1' })
    expect(all).toHaveLength(2)
  })

  it('listCreatives excludes ARCHIVED by default, includes when flag set', async () => {
    await createCreative({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, status: 'READY' } })
    const c2 = await createCreative({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, status: 'READY' } })
    await archiveCreative(c2.id)

    const active = await listCreatives({ orgId: 'org_1' })
    expect(active).toHaveLength(1)
    expect(active[0].status).toBe('READY')

    const withArchived = await listCreatives({ orgId: 'org_1', includeArchived: true })
    expect(withArchived).toHaveLength(2)
  })

  it('updateCreative patches fields and bumps updatedAt', async () => {
    const creative = await createCreative({
      orgId: 'org_1',
      createdBy: 'u1',
      input: BASE_INPUT,
    })

    await updateCreative(creative.id, { name: 'Updated Banner', status: 'READY' })

    const fetched = await getCreative(creative.id)
    expect(fetched?.name).toBe('Updated Banner')
    expect(fetched?.status).toBe('READY')
    expect(fetched?.updatedAt).toBeDefined()
  })

  it('archiveCreative sets status ARCHIVED and archivedAt', async () => {
    const creative = await createCreative({
      orgId: 'org_1',
      createdBy: 'u1',
      input: { ...BASE_INPUT, status: 'READY' },
    })

    await archiveCreative(creative.id)

    const fetched = await getCreative(creative.id)
    expect(fetched?.status).toBe('ARCHIVED')
    expect(fetched?.archivedAt).toBeDefined()
  })

  it('setPlatformRef merges into platformRefs[platform]', async () => {
    const creative = await createCreative({
      orgId: 'org_1',
      createdBy: 'u1',
      input: { ...BASE_INPUT, status: 'READY' },
    })

    const ref: PlatformCreativeRef = {
      creativeId: 'imgh_abc123',
      hash: 'sha256_deadbeef',
      syncedAt: { seconds: 1747000000, nanoseconds: 0 } as any,
    }

    await setPlatformRef(creative.id, 'meta' as AdPlatform, ref)

    const fetched = await getCreative(creative.id)
    expect(fetched?.platformRefs?.meta?.creativeId).toBe('imgh_abc123')
    expect(fetched?.platformRefs?.meta?.hash).toBe('sha256_deadbeef')
  })

  it('isolates creatives by orgId — does not leak across tenants', async () => {
    await createCreative({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, name: 'Org 1 Creative' } })
    await createCreative({ orgId: 'org_2', createdBy: 'u2', input: { ...BASE_INPUT, name: 'Org 2 Creative' } })

    const list1 = await listCreatives({ orgId: 'org_1' })
    const list2 = await listCreatives({ orgId: 'org_2' })

    expect(list1).toHaveLength(1)
    expect(list1[0].name).toBe('Org 1 Creative')
    expect(list2).toHaveLength(1)
    expect(list2[0].name).toBe('Org 2 Creative')
  })

  it('roundtrips source lineage, approval, placement, UTM, version, and backlink metadata', async () => {
    const creative = await createCreative({
      orgId: 'org_1',
      createdBy: 'u1',
      input: {
        ...BASE_INPUT,
        status: 'READY',
        sourceType: 'client_document',
        sourceId: 'doc_1',
        sourceVersionId: 'ver_1',
        sourceOrgId: 'org_1',
        projectId: 'project_1',
        approvalStatus: 'approved',
        approvalTaskId: 'task_approval',
        approvalDocumentId: 'doc_approval',
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
        videoCoverUrl: 'https://cdn.example.com/cover.jpg',
        landingUrl: 'https://example.com/landing',
        utmDefaults: {
          source: 'meta',
          medium: 'paid_social',
          campaign: 'brand_launch_202606',
          content: 'meta_feed_angle_v1_image',
          term: 'warm_audience',
        },
        placementSuitability: [
          {
            platform: 'meta',
            placement: 'feed',
            status: 'suitable',
            checkedAt: { seconds: 1747000000, nanoseconds: 0 } as any,
          },
        ],
        specValidation: {
          status: 'valid',
          checkedAt: { seconds: 1747000000, nanoseconds: 0 } as any,
          checks: [{ key: 'aspect_ratio', status: 'pass' }],
        },
        usageBacklinks: [
          { adId: 'ad_1', adSetId: 'adset_1', campaignId: 'camp_1', platform: 'meta' },
        ],
      },
    })

    const fetched = await getCreative(creative.id)
    expect(fetched).toMatchObject({
      sourceType: 'client_document',
      sourceId: 'doc_1',
      sourceVersionId: 'ver_1',
      sourceOrgId: 'org_1',
      projectId: 'project_1',
      approvalStatus: 'approved',
      approvalTaskId: 'task_approval',
      approvalDocumentId: 'doc_approval',
      thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      videoCoverUrl: 'https://cdn.example.com/cover.jpg',
      landingUrl: 'https://example.com/landing',
      versionNumber: 1,
      isLatest: true,
    })
    expect(fetched?.versionGroupId).toBe(fetched?.id)
    expect(fetched?.utmDefaults?.medium).toBe('paid_social')
    expect(fetched?.placementSuitability?.[0]?.placement).toBe('feed')
    expect(fetched?.specValidation?.checks?.[0]?.status).toBe('pass')
    expect(fetched?.usageBacklinks?.[0]?.adId).toBe('ad_1')
  })

  it('creates tenant-scoped immutable version chains without mutating prior version content', async () => {
    const v1 = await createCreative({
      orgId: 'org_1',
      createdBy: 'u1',
      input: {
        ...BASE_INPUT,
        status: 'READY',
        sourceType: 'content_package',
        sourceId: 'pkg_1',
        sourceVersionId: 'pkg_ver_1',
        sourceOrgId: 'org_1',
        approvalStatus: 'approved',
        landingUrl: 'https://example.com/v1',
      },
    })

    const v2 = await createCreative({
      orgId: 'org_1',
      createdBy: 'u2',
      input: {
        ...BASE_INPUT,
        name: 'Hero Banner v2',
        status: 'READY',
        sourceType: 'content_package',
        sourceId: 'pkg_1',
        sourceVersionId: 'pkg_ver_2',
        sourceOrgId: 'org_1',
        approvalStatus: 'approved',
        landingUrl: 'https://example.com/v2',
        supersedes: v1.id,
        changeSummary: 'Updated paid-media CTA.',
      },
    })

    const fetchedV1 = await getCreative(v1.id)
    const fetchedV2 = await getCreative(v2.id)

    expect(fetchedV1?.landingUrl).toBe('https://example.com/v1')
    expect(fetchedV1?.isLatest).toBe(false)
    expect(fetchedV2?.versionGroupId).toBe(v1.id)
    expect(fetchedV2?.versionNumber).toBe(2)
    expect(fetchedV2?.supersedes).toBe(v1.id)
    expect(fetchedV2?.isLatest).toBe(true)
    expect(fetchedV2?.changeSummary).toBe('Updated paid-media CTA.')
  })

  it('rejects superseding a creative from another tenant', async () => {
    const otherTenant = await createCreative({
      orgId: 'org_2',
      createdBy: 'u2',
      input: { ...BASE_INPUT, status: 'READY' },
    })

    await expect(
      createCreative({
        orgId: 'org_1',
        createdBy: 'u1',
        input: { ...BASE_INPUT, status: 'READY', supersedes: otherTenant.id },
      }),
    ).rejects.toThrow('Cannot supersede creative outside the active org')
  })
})
