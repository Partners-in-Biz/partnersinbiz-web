// __tests__/lib/ads/providers/tiktok/audiences.test.ts
// 8 tests for Sub-3c TikTok Phase 4 — Custom Audience builders + lifecycle helpers.

import {
  createAudience,
  uploadAudienceFile,
  applyAudienceFile,
  createLookalikeAudience,
  getAudienceStatus,
  deleteAudience,
} from '@/lib/ads/providers/tiktok/audiences'
import { rowsToTiktokPayload } from '@/lib/ads/providers/tiktok/audiences-hash'

const BASE_ARGS = {
  advertiserId: 'adv_123',
  accessToken: 'test-token',
}

/** Build a standard TikTok envelope response. */
function makeEnvelope<T>(data: T, code = 0, message = 'OK') {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ code, message, data }),
  }
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(makeEnvelope({ custom_audience_id: '99001' }))
})

afterEach(() => {
  ;(global.fetch as jest.Mock).mockRestore?.()
})

// ─── Test 1: createAudience POSTs to /create/ with audience_type ─────────────
it('createAudience POSTs /dmp/custom_audience/create/ with advertiser_id + audience_type', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(
    makeEnvelope({ custom_audience_id: '11111' }),
  )

  const result = await createAudience({
    ...BASE_ARGS,
    name: 'Test Customer File',
    audienceType: 'CUSTOMER_FILE',
    description: 'Smoke test',
    fetchImpl: global.fetch,
  })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/dmp/custom_audience/create/')
  expect(init.method).toBe('POST')

  const body = JSON.parse(init.body as string)
  expect(body.advertiser_id).toBe('adv_123')
  expect(body.custom_audience_name).toBe('Test Customer File')
  expect(body.audience_type).toBe('CUSTOMER_FILE')
  expect(body.description).toBe('Smoke test')

  expect(result).toEqual({ customAudienceId: '11111' })
})

// ─── Test 2: uploadAudienceFile POSTs multipart with file_signature ───────────
it('uploadAudienceFile POSTs multipart with file_signature + custom_audience_file', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(
    makeEnvelope({ file_path: 'tiktok://path/to/file', file_id: 'fid_001' }),
  )

  const payload = 'abc123\ndef456'
  const result = await uploadAudienceFile({
    ...BASE_ARGS,
    customAudienceId: 'aud_001',
    payload,
    fetchImpl: global.fetch,
  })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/dmp/custom_audience/file/upload/')
  expect(init.method).toBe('POST')

  // Headers should include Access-Token (not Authorization Bearer)
  const headers = init.headers as Record<string, string>
  expect(headers['Access-Token']).toBe('test-token')

  // Body is FormData — just verify it's not JSON stringified
  expect(typeof init.body).not.toBe('string')

  expect(result).toEqual({ filePath: 'tiktok://path/to/file', fileId: 'fid_001' })
})

// ─── Test 3: uploadAudienceFile throws when TikTok code !== 0 ────────────────
it('uploadAudienceFile throws when TikTok envelope code !== 0', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ code: 40002, message: 'invalid audience id', data: {} }),
  })

  await expect(
    uploadAudienceFile({
      ...BASE_ARGS,
      customAudienceId: 'bad-id',
      payload: 'somehash',
      fetchImpl: global.fetch,
    }),
  ).rejects.toThrow(/code=40002.*invalid audience id/)
})

// ─── Test 4: applyAudienceFile POSTs /apply/ with file_paths ─────────────────
it('applyAudienceFile POSTs /dmp/custom_audience/apply/ with custom_audience_id + file_paths', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(makeEnvelope({}))

  await applyAudienceFile({
    ...BASE_ARGS,
    customAudienceId: 'aud_001',
    filePaths: ['tiktok://path/to/file'],
    fetchImpl: global.fetch,
  })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/dmp/custom_audience/apply/')
  expect(init.method).toBe('POST')

  const body = JSON.parse(init.body as string)
  expect(body.advertiser_id).toBe('adv_123')
  expect(body.custom_audience_id).toBe('aud_001')
  expect(body.file_paths).toEqual(['tiktok://path/to/file'])
})

// ─── Test 5: createLookalikeAudience posts source + locationIds + lookalike_spec ─
it('createLookalikeAudience POSTs source_custom_audience_id + location_ids + lookalike_spec (default BALANCE)', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(
    makeEnvelope({ custom_audience_id: '22222' }),
  )

  const result = await createLookalikeAudience({
    ...BASE_ARGS,
    name: 'My Lookalike',
    sourceCustomAudienceId: 'src_aud_001',
    locationIds: [7, 8],
    fetchImpl: global.fetch,
  })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/dmp/custom_audience/lookalike/create/')
  expect(init.method).toBe('POST')

  const body = JSON.parse(init.body as string)
  expect(body.advertiser_id).toBe('adv_123')
  expect(body.custom_audience_name).toBe('My Lookalike')
  expect(body.source_custom_audience_id).toBe('src_aud_001')
  expect(body.location_ids).toEqual([7, 8])
  expect(body.lookalike_spec).toBe('BALANCE')  // default

  expect(result).toEqual({ customAudienceId: '22222' })
})

// ─── Test 6: getAudienceStatus returns mapped status + approximateUserNum ─────
it('getAudienceStatus returns status + approximateUserNum from /get/ response', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(
    makeEnvelope({
      list: [
        {
          custom_audience_id: 'aud_001',
          audience_status: 'READY',
          approximate_user_num: 5000,
        },
      ],
    }),
  )

  const result = await getAudienceStatus({
    ...BASE_ARGS,
    customAudienceId: 'aud_001',
    fetchImpl: global.fetch,
  })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/dmp/custom_audience/get/')
  expect(init.method).toBe('POST')

  const body = JSON.parse(init.body as string)
  expect(body.custom_audience_ids).toEqual(['aud_001'])

  expect(result).toEqual({ status: 'READY', approximateUserNum: 5000 })
})

// ─── Test 7: deleteAudience POSTs /delete/ with custom_audience_ids ───────────
it('deleteAudience POSTs /dmp/custom_audience/delete/ with custom_audience_ids array', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(makeEnvelope({}))

  await deleteAudience({
    ...BASE_ARGS,
    customAudienceId: 'aud_del_001',
    fetchImpl: global.fetch,
  })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/dmp/custom_audience/delete/')
  expect(init.method).toBe('POST')

  const body = JSON.parse(init.body as string)
  expect(body.advertiser_id).toBe('adv_123')
  expect(body.custom_audience_ids).toEqual(['aud_del_001'])
})

// ─── Test 8: rowsToTiktokPayload produces newline-delimited SHA-256 hashes ────
it('rowsToTiktokPayload produces newline-delimited hashes — email + phone each on own line', () => {
  const { createHash } = require('crypto') as typeof import('crypto')

  const emailHash = createHash('sha256')
    .update('smoke@example.com', 'utf8')
    .digest('hex')
  const phoneHash = createHash('sha256')
    .update('+15555550199', 'utf8')
    .digest('hex')

  const payload = rowsToTiktokPayload([
    { email: 'SMOKE@example.com ' },  // upper-case + trailing space → normalised
    { phone: '+1 555-555-0199' },     // dashes/spaces stripped
  ])

  const lines = payload.split('\n')
  expect(lines).toHaveLength(2)
  expect(lines[0]).toBe(emailHash)
  expect(lines[1]).toBe(phoneHash)
})
