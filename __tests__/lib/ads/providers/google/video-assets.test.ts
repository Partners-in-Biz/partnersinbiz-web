// __tests__/lib/ads/providers/google/video-assets.test.ts
import { createYoutubeVideoAsset } from '@/lib/ads/providers/google/video-assets'

global.fetch = jest.fn() as jest.Mock

const baseArgs = {
  customerId: '1234567890',
  accessToken: 'test-access',
  developerToken: 'test-dev',
}

describe('video-assets — createYoutubeVideoAsset', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
  })

  it('creates asset and calls assets:mutate with YOUTUBE_VIDEO type', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ resourceName: 'customers/1234567890/assets/42' }] }),
    })

    const result = await createYoutubeVideoAsset({
      ...baseArgs,
      youtubeVideoId: 'dQw4w9WgXcQ',
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/assets:mutate/)
    const body = JSON.parse(init.body as string)
    const create = body.operations[0].create
    expect(create.type).toBe('YOUTUBE_VIDEO')
    expect(create.youtubeVideoAsset.youtubeVideoId).toBe('dQw4w9WgXcQ')
  })

  it('returns resourceName and numeric id from last path segment', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ resourceName: 'customers/1234567890/assets/99999' }] }),
    })

    const result = await createYoutubeVideoAsset({
      ...baseArgs,
      youtubeVideoId: 'abc12345678',
    })

    expect(result.resourceName).toBe('customers/1234567890/assets/99999')
    expect(result.id).toBe('99999')
  })

  it('throws on non-2xx response with descriptive message', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'PERMISSION_DENIED',
    })

    await expect(
      createYoutubeVideoAsset({
        ...baseArgs,
        youtubeVideoId: 'dQw4w9WgXcQ',
      }),
    ).rejects.toThrow('Google YouTube video asset create failed: HTTP 403')
  })
})
