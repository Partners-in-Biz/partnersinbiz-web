import { pollNousDeviceToken, startNousDeviceCode } from '@/lib/llm-providers/oauth/nous'

const fetchMock = jest.fn()

describe('Nous Portal OAuth device flow', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('starts a Hermes-compatible device-code flow with the required invoke scope', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: 'device-code',
        user_code: 'USER-CODE',
        verification_uri: 'https://portal.nousresearch.com/device',
        verification_uri_complete: 'https://portal.nousresearch.com/device?code=USER-CODE',
        expires_in: 900,
        interval: 5,
      }),
    })

    await expect(startNousDeviceCode()).resolves.toEqual({
      deviceCode: 'device-code',
      userCode: 'USER-CODE',
      verificationUri: 'https://portal.nousresearch.com/device',
      verificationUriComplete: 'https://portal.nousresearch.com/device?code=USER-CODE',
      tokenEndpoint: 'https://portal.nousresearch.com/api/oauth/token',
      expiresIn: 900,
      intervalSeconds: 5,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://portal.nousresearch.com/api/oauth/device/code',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      }),
    )
    expect(fetchMock.mock.calls[0][1].body.toString()).toBe('client_id=hermes-cli&scope=inference%3Ainvoke')
  })

  it('returns a completed OAuth token without exposing it to the UI layer', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        access_token: 'secret-access-token',
        refresh_token: 'secret-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    })

    await expect(pollNousDeviceToken({
      tokenEndpoint: 'https://portal.nousresearch.com/api/oauth/token',
      deviceCode: 'device-code',
    })).resolves.toEqual({
      status: 'completed',
      tokens: {
        access_token: 'secret-access-token',
        refresh_token: 'secret-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    })
  })

  it('keeps pending and failure responses distinct for the UI poller', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 400,
      json: async () => ({ error: 'authorization_pending' }),
    }).mockResolvedValueOnce({
      status: 400,
      json: async () => ({ error: 'access_denied', error_description: 'Sign-in was denied' }),
    })

    await expect(pollNousDeviceToken({ tokenEndpoint: 'https://portal.nousresearch.com/api/oauth/token', deviceCode: 'device-code' }))
      .resolves.toEqual({ status: 'pending' })
    await expect(pollNousDeviceToken({ tokenEndpoint: 'https://portal.nousresearch.com/api/oauth/token', deviceCode: 'device-code' }))
      .resolves.toEqual({ status: 'failed', error: 'Sign-in was denied' })
  })
})
