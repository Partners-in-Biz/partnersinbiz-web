import { InstagramProvider } from '@/lib/social/providers/instagram'

describe('InstagramProvider', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('creates and publishes single-image posts with form-encoded Graph API POSTs', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'container-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'media-1' }),
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new InstagramProvider({
      accessToken: 'ig-token',
      personUrn: '17841400000000001',
    })

    const result = await provider.publishPost({
      text: 'Hello Instagram',
      mediaUrls: ['https://cdn.example.com/post.jpg'],
    })

    expect(result.platformPostId).toBe('media-1')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://graph.instagram.com/v25.0/17841400000000001/media',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )
    const createBody = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(createBody.get('caption')).toBe('Hello Instagram')
    expect(createBody.get('image_url')).toBe('https://cdn.example.com/post.jpg')
    expect(createBody.get('access_token')).toBe('ig-token')

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://graph.instagram.com/v25.0/17841400000000001/media_publish',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )
    const publishBody = new URLSearchParams(fetchMock.mock.calls[1][1].body)
    expect(publishBody.get('creation_id')).toBe('container-1')
    expect(publishBody.get('access_token')).toBe('ig-token')
  })

  it('can publish through a Facebook Graph API-backed Instagram account', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'container-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'media-1' }),
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new InstagramProvider({
      accessToken: 'page-token',
      personUrn: '17841448015964001',
      instanceUrl: 'https://graph.facebook.com/v25.0',
    })

    await provider.publishPost({
      text: 'Hello Instagram',
      mediaUrls: ['https://cdn.example.com/post.jpg'],
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v25.0/17841448015964001/media',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://graph.facebook.com/v25.0/17841448015964001/media_publish',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('checks a video container is finished before publishing it', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'video-container-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status_code: 'FINISHED' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ig-media-1' }),
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new InstagramProvider({
      accessToken: 'page-token',
      personUrn: '17841448015964001',
      instanceUrl: 'https://graph.facebook.com/v25.0',
    })

    await provider.publishPost({
      text: 'Video post',
      mediaUrls: ['https://cdn.example.com/video.mp4'],
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://graph.facebook.com/v25.0/video-container-1?fields=status_code',
      { headers: { Authorization: 'Bearer page-token' } },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://graph.facebook.com/v25.0/17841448015964001/media_publish',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
