import { exchangeInstagramLongLivedToken } from '@/lib/social/instagram-oauth'

describe('exchangeInstagramLongLivedToken', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('uses Meta documented GET exchange first', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'IGQV_long',
        token_type: 'bearer',
        expires_in: 5184000,
      }),
    })

    const result = await exchangeInstagramLongLivedToken('IGQV_short', 'secret')

    expect(result).toEqual({ accessToken: 'IGQV_long', expiresIn: 5184000, exchanged: true })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(url).toContain('https://graph.instagram.com/access_token?')
    expect(url).toContain('grant_type=ig_exchange_token')
    expect(url).toContain('client_secret=secret')
    expect(url).toContain('access_token=IGQV_short')
  })

  it('falls back to POST only when Meta rejects GET by method type', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: {
            message: 'Unsupported request - method type: get',
            type: 'IGApiException',
            code: 100,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          access_token: 'IGQV_long_post',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      })

    const result = await exchangeInstagramLongLivedToken('IGQV_short', 'secret')

    expect(result).toEqual({ accessToken: 'IGQV_long_post', expiresIn: 5184000, exchanged: true })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe('https://graph.instagram.com/access_token')
    expect((global.fetch as jest.Mock).mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const body = new URLSearchParams((global.fetch as jest.Mock).mock.calls[1][1].body)
    expect(body.get('grant_type')).toBe('ig_exchange_token')
    expect(body.get('client_secret')).toBe('secret')
    expect(body.get('access_token')).toBe('IGQV_short')
  })

  it('does not retry non-method Instagram errors', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: {
          message: 'Invalid OAuth access token.',
          type: 'OAuthException',
          code: 190,
        },
      }),
    })

    await expect(exchangeInstagramLongLivedToken('bad', 'secret')).rejects.toThrow(
      /Instagram long-lived token exchange failed: Invalid OAuth access token/,
    )
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the original Instagram token when both exchange methods are unsupported', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: {
            message: 'Unsupported request - method type: get',
            type: 'IGApiException',
            code: 100,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: {
            message: 'Unsupported request - method type: post',
            type: 'IGApiException',
            code: 100,
          },
        }),
      })

    const result = await exchangeInstagramLongLivedToken('IGQV_short', 'secret')

    expect(result).toEqual({ accessToken: 'IGQV_short', expiresIn: null, exchanged: false })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
