import { syncImageCreative, syncVideoCreative, ensureSynced } from '@/lib/ads/providers/meta/creative-sync'
import type { AdCreative } from '@/lib/ads/types'

jest.mock('@/lib/ads/providers/meta/image-upload', () => ({
  uploadImageFromUrl: jest.fn(),
}))
jest.mock('@/lib/ads/creatives/store', () => ({
  setPlatformRef: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ seconds: 1, nanoseconds: 0 }) },
}))

const upload = jest.requireMock('@/lib/ads/providers/meta/image-upload')
const store = jest.requireMock('@/lib/ads/creatives/store')

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn() as unknown as typeof fetch
})

function makeImageCreative(over: Partial<AdCreative> = {}): AdCreative {
  return {
    id: 'crv_1',
    orgId: 'org_1',
    type: 'image',
    name: 'X',
    storagePath: 'orgs/org_1/ad_creatives/crv_1/source.jpg',
    sourceUrl: 'https://storage/x.jpg',
    fileSize: 1000,
    mimeType: 'image/jpeg',
    status: 'READY',
    platformRefs: {},
    createdBy: 'u',
    createdAt: {} as any,
    updatedAt: {} as any,
    ...over,
  } as AdCreative
}

describe('syncImageCreative', () => {
  it('uploads image bytes via /adimages helper and returns hash', async () => {
    upload.uploadImageFromUrl.mockResolvedValueOnce('imghash_abc')
    const r = await syncImageCreative({
      adAccountId: 'act_42',
      accessToken: 'EAAO',
      creative: makeImageCreative(),
    })
    expect(r.metaCreativeId).toBe('imghash_abc')
    expect(r.hash).toBe('imghash_abc')
    expect(upload.uploadImageFromUrl).toHaveBeenCalledWith({
      adAccountId: 'act_42',
      accessToken: 'EAAO',
      sourceUrl: 'https://storage/x.jpg',
    })
  })

  it('rejects non-image/non-carousel_card', async () => {
    await expect(
      syncImageCreative({
        adAccountId: 'a',
        accessToken: 't',
        creative: makeImageCreative({ type: 'video' }),
      }),
    ).rejects.toThrow(/syncImageCreative called with type video/)
  })

  it('blocks provider sync when required image fields are missing', async () => {
    await expect(
      syncImageCreative({
        adAccountId: 'a',
        accessToken: 't',
        creative: makeImageCreative({ sourceUrl: '' }),
      }),
    ).rejects.toThrow(/missing sourceUrl, mimeType, or fileSize/)
    expect(upload.uploadImageFromUrl).not.toHaveBeenCalled()
  })
})

describe('syncVideoCreative', () => {
  it('downloads bytes and POSTs to /advideos with FormData', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'video_42' }) })
    const r = await syncVideoCreative({
      adAccountId: '99',
      accessToken: 'EAAO',
      creative: makeImageCreative({ type: 'video', mimeType: 'video/mp4', sourceUrl: 'https://storage/v.mp4', duration: 30 }),
    })
    expect(r.metaCreativeId).toBe('video_42')
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('act_99/advideos')
  })

  it('throws when Meta error envelope returned', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'Bad video' } }) })
    await expect(
      syncVideoCreative({
        adAccountId: 'act_1',
        accessToken: 't',
        creative: makeImageCreative({ type: 'video', mimeType: 'video/mp4', duration: 30 }),
      }),
    ).rejects.toThrow(/Bad video/)
  })

  it('blocks provider sync when required video metadata is missing', async () => {
    await expect(
      syncVideoCreative({
        adAccountId: 'act_1',
        accessToken: 't',
        creative: makeImageCreative({ type: 'video', mimeType: 'video/mp4', duration: undefined }),
      }),
    ).rejects.toThrow(/missing sourceUrl, mimeType, fileSize, or duration/)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('ensureSynced', () => {
  it('returns cached ref when platformRefs.meta already exists', async () => {
    const r = await ensureSynced({
      orgId: 'org_1',
      adAccountId: 'act_42',
      accessToken: 't',
      creative: makeImageCreative({
        platformRefs: { meta: { creativeId: 'cached_hash', syncedAt: {} as any } },
      }),
    })
    expect(r.metaCreativeId).toBe('cached_hash')
    expect(r.alreadySynced).toBe(true)
    expect(upload.uploadImageFromUrl).not.toHaveBeenCalled()
    expect(store.setPlatformRef).not.toHaveBeenCalled()
  })

  it('syncs an image creative and persists the ref', async () => {
    upload.uploadImageFromUrl.mockResolvedValueOnce('new_hash')
    const r = await ensureSynced({
      orgId: 'org_1',
      adAccountId: 'act_42',
      accessToken: 't',
      creative: makeImageCreative(),
    })
    expect(r.metaCreativeId).toBe('new_hash')
    expect(r.alreadySynced).toBe(false)
    expect(store.setPlatformRef).toHaveBeenCalledWith(
      'crv_1',
      'meta',
      expect.objectContaining({ creativeId: 'new_hash' }),
    )
  })

  it('syncs a video creative when type=video', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'video_999' }) })
    const r = await ensureSynced({
      orgId: 'org_1',
      adAccountId: 'act_42',
      accessToken: 't',
      creative: makeImageCreative({ type: 'video', mimeType: 'video/mp4', sourceUrl: 'https://x/v.mp4', duration: 30 }),
    })
    expect(r.metaCreativeId).toBe('video_999')
    expect(store.setPlatformRef).toHaveBeenCalled()
  })
})
