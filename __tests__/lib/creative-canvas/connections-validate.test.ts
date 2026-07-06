import { validateProviderCredentials } from '@/lib/creative-canvas/connections/validate'

describe('validateProviderCredentials', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockReset?.() })

  it('validates an xai key against /v1/models', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch
    const result = await validateProviderCredentials('xai', { apiKey: 'xai-good' })
    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith('https://api.x.ai/v1/models', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer xai-good' }),
    }))
  })

  it('reports invalid keys with the provider status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch
    const result = await validateProviderCredentials('recraft', { apiKey: 'bad' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })

  it('fal uses Key auth scheme', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch
    await validateProviderCredentials('fal', { apiKey: 'fal-k' })
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Key fal-k')
  })

  it('higgsfield requires key AND secret, no network call', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    expect(await validateProviderCredentials('higgsfield', { apiKey: 'k' })).toEqual({ ok: false, error: 'Higgsfield needs both API key and secret' })
    expect(await validateProviderCredentials('higgsfield', { apiKey: 'k', apiSecret: 's' })).toEqual({ ok: true })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('missing apiKey fails fast without network', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const result = await validateProviderCredentials('xai', {})
    expect(result).toEqual({ ok: false, error: 'API key is required' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('network failure is reported, not thrown', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch
    const result = await validateProviderCredentials('google', { apiKey: 'AIza-x' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('ECONNRESET')
  })

  it('rejects unknown providers', async () => {
    await expect(validateProviderCredentials('manual_upload', {})).resolves.toEqual({ ok: false, error: 'Provider does not support connections' })
  })
})
