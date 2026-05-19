const mockFetch = jest.fn()
global.fetch = mockFetch

import { LinkedInProvider } from '@/lib/social/providers/linkedin'

const creds = { accessToken: 'test-token', personUrn: 'urn:li:person:abc123' }

function makeProvider() {
  return new LinkedInProvider(creds)
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('LinkedInProvider guessMimeType', () => {
  const p = makeProvider()
  const guess = (p as unknown as { guessMimeType: (u: string) => string }).guessMimeType.bind(p)

  it('detects mp4', () => expect(guess('https://cdn.example.com/video.mp4')).toBe('video/mp4'))
  it('detects png', () => expect(guess('https://cdn.example.com/image.png')).toBe('image/png'))
  it('defaults to jpeg', () => expect(guess('https://cdn.example.com/photo')).toBe('image/jpeg'))
  it('strips query strings', () => expect(guess('https://cdn.example.com/image.png?v=1')).toBe('image/png'))
})

describe('LinkedInProvider publishPost with image', () => {
  it('uploads image and includes content.media in post body', async () => {
    const imageBuffer = Buffer.from('fake-image')

    // 1: download image
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => imageBuffer.buffer,
      headers: { get: (h: string) => h === 'content-type' ? 'image/jpeg' : null },
    })
    // 2: initializeUpload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '',
      json: async () => ({ value: { uploadUrl: 'https://upload.linkedin.com/xxx', image: 'urn:li:image:12345' } }),
    })
    // 3: PUT binary
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '' })
    // 4: POST /rest/posts
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '',
      json: async () => ({}),
      headers: { get: (h: string) => h === 'x-restli-id' ? 'urn:li:share:999' : null },
    })

    const p = makeProvider()
    const result = await p.publishPost({
      text: 'Check this out',
      mediaUrls: ['https://storage.googleapis.com/bucket/photo.jpg'],
    })

    expect(result.platformPostId).toBe('urn:li:share:999')
    const postBody = JSON.parse(mockFetch.mock.calls[3][1].body)
    expect(postBody.content.media.id).toBe('urn:li:image:12345')
    expect(postBody.mediaCategory).toBeUndefined()
    expect(postBody.commentary).toBe('Check this out')
  })

  it('publishes text-only post when no mediaUrls', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '',
      json: async () => ({}),
      headers: { get: (h: string) => h === 'x-restli-id' ? 'urn:li:share:888' : null },
    })

    const p = makeProvider()
    const result = await p.publishPost({ text: 'Text only' })
    expect(result.platformPostId).toBe('urn:li:share:888')
    const postBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(postBody.content).toBeUndefined()
    expect(postBody.mediaCategory).toBeUndefined()
  })
})
