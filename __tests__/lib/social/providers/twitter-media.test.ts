const mockFetch = jest.fn()
global.fetch = mockFetch

import { TwitterProvider } from '@/lib/social/providers/twitter'

const creds = {
  apiKey: 'key',
  apiKeySecret: 'secret',
  accessToken: 'token',
  accessTokenSecret: 'tokenSecret',
}

function makeProvider() {
  return new TwitterProvider(creds)
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('TwitterProvider guessMimeType', () => {
  const p = makeProvider()
  // Access private method via type assertion for testing
  const guessMimeType = (p as unknown as { guessMimeType: (u: string) => string }).guessMimeType.bind(p)

  it('detects mp4', () => expect(guessMimeType('https://cdn.example.com/video.mp4')).toBe('video/mp4'))
  it('detects mov', () => expect(guessMimeType('https://cdn.example.com/clip.mov')).toBe('video/quicktime'))
  it('detects png', () => expect(guessMimeType('https://cdn.example.com/image.png')).toBe('image/png'))
  it('detects gif', () => expect(guessMimeType('https://cdn.example.com/anim.gif')).toBe('image/gif'))
  it('detects webp', () => expect(guessMimeType('https://cdn.example.com/photo.webp')).toBe('image/webp'))
  it('defaults to jpeg', () => expect(guessMimeType('https://storage.googleapis.com/bucket/photo')).toBe('image/jpeg'))
  it('strips query strings', () => expect(guessMimeType('https://cdn.example.com/image.png?v=1')).toBe('image/png'))
})

describe('TwitterProvider publishPost with mediaUrls', () => {
  it('uploads image and attaches media_ids to tweet', async () => {
    const imageBuffer = Buffer.from('fake-image')
    // 1: download image
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => imageBuffer.buffer,
    })
    // 2: Twitter media upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ media_id_string: '99999' }),
    })
    // 3: Tweet POST
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'tweet-123' } }),
    })

    const p = makeProvider()
    const result = await p.publishPost({
      text: 'Hello with image',
      mediaUrls: ['https://storage.googleapis.com/bucket/photo.jpg'],
    })

    expect(result.platformPostId).toBe('tweet-123')
    const tweetBody = JSON.parse(mockFetch.mock.calls[2][1].body)
    expect(tweetBody.media).toEqual({ media_ids: ['99999'] })
    expect(tweetBody.text).toBe('Hello with image')
  })

  it('publishes text-only tweet when no mediaUrls', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'tweet-456' } }),
    })

    const p = makeProvider()
    const result = await p.publishPost({ text: 'Text only' })
    expect(result.platformPostId).toBe('tweet-456')
    const tweetBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(tweetBody.media).toBeUndefined()
  })

  it('fails fast with a clear setup error when an OAuth 2 account tries to upload media', async () => {
    const oauth2Provider = new TwitterProvider({ accessToken: 'oauth2-user-token' })

    await expect(oauth2Provider.publishPost({
      text: 'Image post',
      mediaUrls: ['https://storage.googleapis.com/bucket/photo.jpg'],
    })).rejects.toThrow('Twitter/X media upload requires OAuth 1.0a credentials or an OAuth 2 token with media upload support')

    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('TwitterProvider publishThread with mediaUrls', () => {
  it('attaches media to first tweet only in a 3-part thread', async () => {
    const imageBuffer = Buffer.from('img')
    // Download + upload for tweet 1 media
    mockFetch
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => imageBuffer.buffer }) // download
      .mockResolvedValueOnce({ ok: true, json: async () => ({ media_id_string: '111' }) }) // upload
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 't1' } }) }) // tweet 1
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 't2' } }) }) // tweet 2
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 't3' } }) }) // tweet 3

    const p = makeProvider()
    const results = await p.publishThread(
      ['Part 1', 'Part 2', 'Part 3'],
      ['https://storage.googleapis.com/bucket/img.jpg'],
    )

    expect(results).toHaveLength(3)
    expect(results[0].platformPostId).toBe('t1')
    expect(results[1].platformPostId).toBe('t2')

    // Tweet 1 has media
    const tweet1Body = JSON.parse(mockFetch.mock.calls[2][1].body)
    expect(tweet1Body.media).toEqual({ media_ids: ['111'] })

    // Tweet 2 has no media
    const tweet2Body = JSON.parse(mockFetch.mock.calls[3][1].body)
    expect(tweet2Body.media).toBeUndefined()
  })
})
