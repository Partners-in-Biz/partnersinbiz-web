// __tests__/lib/ads/providers/linkedin/creative-sync.test.ts
import {
  registerImageUpload,
  uploadImageBytes,
  registerAndUploadImage,
} from '@/lib/ads/providers/linkedin/creative-sync'

const MOCK_ASSET_URN = 'urn:li:digitalmediaAsset:abc'
const MOCK_UPLOAD_URL = 'https://upload.example/u1'

/** Build a minimal registerUpload success response */
function makeRegisterResponse(overrides?: Partial<{ asset: string; uploadUrl: string; extraHeaders: Record<string, string> }>) {
  const asset = overrides?.asset ?? MOCK_ASSET_URN
  const uploadUrl = overrides?.uploadUrl ?? MOCK_UPLOAD_URL
  const extraHeaders = overrides?.extraHeaders ?? { 'X-Foo': 'bar' }
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      value: {
        asset,
        uploadMechanism: {
          'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
            uploadUrl,
            headers: extraHeaders,
          },
        },
      },
    }),
  }
}

/** Build a minimal 201 upload success response */
function makeUploadResponse() {
  return {
    ok: true,
    status: 201,
    text: async () => '',
    json: async () => ({}),
  }
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(makeRegisterResponse())
})

afterEach(() => {
  ;(global.fetch as jest.Mock).mockRestore?.()
})

describe('LinkedIn creative-sync — asset register + upload', () => {
  // ─── Test 1: registerImageUpload sends correct request + returns correct result ──
  it('registerImageUpload sends POST /assets?action=registerUpload with feedshare-image recipe + owner URN and returns assetUrn + uploadUrl + uploadHeaders', async () => {
    const result = await registerImageUpload({
      accessToken: 'test-token',
      ownerUrn: 'urn:li:organization:999',
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]

    // URL is correct
    expect(url).toBe('https://api.linkedin.com/rest/assets?action=registerUpload')

    // Method is POST
    expect(init.method).toBe('POST')

    // Required headers present
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(headers['LinkedIn-Version']).toBe('202405')
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0')
    expect(headers['Content-Type']).toBe('application/json')

    // Body shape matches spec
    const body = JSON.parse(init.body as string)
    expect(body.registerUploadRequest.owner).toBe('urn:li:organization:999')
    expect(body.registerUploadRequest.recipes).toEqual(['urn:li:digitalmediaRecipe:feedshare-image'])
    expect(body.registerUploadRequest.serviceRelationships).toEqual([
      { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
    ])
    expect(body.registerUploadRequest.supportedUploadMechanism).toEqual(['SYNCHRONOUS_UPLOAD'])

    // Returned result matches the mock response
    expect(result).toEqual({
      assetUrn: MOCK_ASSET_URN,
      uploadUrl: MOCK_UPLOAD_URL,
      uploadHeaders: { 'X-Foo': 'bar' },
    })
  })

  // ─── Test 2: registerImageUpload throws on missing asset URN ─────────────────
  it('registerImageUpload throws when asset URN is missing from response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ value: {} }),
    })

    await expect(
      registerImageUpload({ accessToken: 'test-token', ownerUrn: 'urn:li:organization:999' }),
    ).rejects.toThrow('LinkedIn registerUpload response missing asset URN')
  })

  // ─── Test 3: registerImageUpload throws on missing uploadUrl ─────────────────
  it('registerImageUpload throws when uploadUrl is missing from response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        value: {
          asset: MOCK_ASSET_URN,
          // uploadMechanism is absent — Object.values({}) returns []
        },
      }),
    })

    await expect(
      registerImageUpload({ accessToken: 'test-token', ownerUrn: 'urn:li:organization:999' }),
    ).rejects.toThrow('LinkedIn registerUpload response missing uploadUrl')
  })

  // ─── Test 4: uploadImageBytes PUTs bytes with correct headers; throws on error ─
  it('uploadImageBytes PUTs bytes to the URL with Content-Type header and throws on non-OK response', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes

    // Successful PUT
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(makeUploadResponse())

    await uploadImageBytes({
      uploadUrl: MOCK_UPLOAD_URL,
      bytes,
      contentType: 'image/jpeg',
      accessToken: 'test-token',
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]

    expect(url).toBe(MOCK_UPLOAD_URL)
    expect(init.method).toBe('PUT')

    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('image/jpeg')
    expect(headers.Authorization).toBe('Bearer test-token')

    // Body preserves the bytes, though uploadImageBytes may copy the view.
    expect(Array.from(init.body as Uint8Array)).toEqual(Array.from(bytes))

    // Now test that it throws on non-OK
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    })

    await expect(
      uploadImageBytes({
        uploadUrl: MOCK_UPLOAD_URL,
        bytes,
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow(/LinkedIn asset upload PUT failed: HTTP 400/)
  })

  // ─── Test 5: registerAndUploadImage performs both steps and returns assetUrn ──
  it('registerAndUploadImage performs register then upload and returns assetUrn matching register step', async () => {
    const bytes = new Uint8Array([0xff, 0xd8]) // JPEG magic bytes

    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeRegisterResponse())
      .mockResolvedValueOnce(makeUploadResponse())

    const result = await registerAndUploadImage({
      accessToken: 'test-token',
      ownerUrn: 'urn:li:organization:999',
      bytes,
      contentType: 'image/jpeg',
    })

    // Returned assetUrn matches the register step
    expect(result).toEqual({ assetUrn: MOCK_ASSET_URN })

    // Two fetches: register + upload
    expect(global.fetch).toHaveBeenCalledTimes(2)

    // First call was the register POST
    const [registerUrl] = (global.fetch as jest.Mock).mock.calls[0]
    expect(registerUrl).toBe('https://api.linkedin.com/rest/assets?action=registerUpload')

    // Second call was the upload PUT to the upload URL from the register response
    const [uploadUrl, uploadInit] = (global.fetch as jest.Mock).mock.calls[1]
    expect(uploadUrl).toBe(MOCK_UPLOAD_URL)
    expect(uploadInit.method).toBe('PUT')
    expect(Array.from(uploadInit.body as Uint8Array)).toEqual(Array.from(bytes))
  })
})
