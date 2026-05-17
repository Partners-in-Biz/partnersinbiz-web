// __tests__/lib/ads/providers/linkedin/audiences.test.ts
// 15 tests for Phase 3 Batch 2A LinkedIn DMP Segment audience builders.

import {
  createContactListAudience,
  createWebsiteAudience,
  createLookalikeAudience,
  createEngagementAudience,
  createAppAudience,
  getAudienceStatus,
  archiveAudience,
} from '@/lib/ads/providers/linkedin/audiences'

const BASE_ARGS = {
  accountUrn: 'urn:li:sponsoredAccount:111',
  accessToken: 'test-token',
}

function makeOkResponse(id: string, headers?: Record<string, string>) {
  return {
    ok: true,
    status: 201,
    headers: new Headers({ 'X-RestLi-Id': id, ...(headers ?? {}) }),
    text: async () => '',
    json: async () => ({}),
  }
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(makeOkResponse('99999'))
})

afterEach(() => {
  ;(global.fetch as jest.Mock).mockRestore?.()
})

// ─── Test 1: createContactListAudience basic shape ────────────────────────────
it('createContactListAudience POSTs correct body + returns URN from X-RestLi-Id', async () => {
  const result = await createContactListAudience({ ...BASE_ARGS, name: 'My CL' })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://api.linkedin.com/rest/dmpSegments')
  expect(init.method).toBe('POST')

  const body = JSON.parse(init.body as string)
  expect(body.name).toBe('My CL')
  expect(body.type).toBe('USER')
  expect(body.account).toBe('urn:li:sponsoredAccount:111')
  expect(body.destinations).toEqual([{ destination: 'LINKEDIN' }])
  expect(body.sourcePlatform).toBe('API')

  expect(result).toEqual({ urn: 'urn:li:dmpSegment:99999', id: '99999' })
})

// ─── Test 2: createContactListAudience throws on non-OK ──────────────────────
it('createContactListAudience throws on non-OK HTTP response', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 422,
    headers: new Headers(),
    text: async () => 'Unprocessable',
    json: async () => ({}),
  })

  await expect(
    createContactListAudience({ ...BASE_ARGS, name: 'Bad' }),
  ).rejects.toThrow(/LinkedIn contact list audience create failed: HTTP 422/)
})

// ─── Test 3: createWebsiteAudience body shape ──────────────────────────────────
it('createWebsiteAudience POSTs websiteAudienceSource with insightTagId + rules; returns URN', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse('88888'))

  const result = await createWebsiteAudience({
    ...BASE_ARGS,
    name: 'Website Retarget',
    insightTagId: 'tag-123',
    rules: [{ matchType: 'CONTAINS', url: '/pricing' }],
  })

  const [, init] = (global.fetch as jest.Mock).mock.calls[0]
  const body = JSON.parse(init.body as string)

  expect(body.type).toBe('WEB_SITE')
  expect(body.websiteAudienceSource).toEqual({
    insightTagId: 'tag-123',
    rules: [{ matchType: 'CONTAINS', url: '/pricing' }],
  })
  expect(result).toEqual({ urn: 'urn:li:dmpSegment:88888', id: '88888' })
})

// ─── Test 4: createWebsiteAudience rejects empty rules ───────────────────────
it('createWebsiteAudience throws when rules array is empty', async () => {
  await expect(
    createWebsiteAudience({
      ...BASE_ARGS,
      name: 'Empty rules',
      insightTagId: 'tag-x',
      rules: [],
    }),
  ).rejects.toThrow('createWebsiteAudience: rules array must be non-empty')

  // fetch should NOT have been called
  expect(global.fetch).not.toHaveBeenCalled()
})

// ─── Test 5: createLookalikeAudience body shape ───────────────────────────────
it('createLookalikeAudience POSTs sourceSegment + type LOOKALIKE; returns URN', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse('77777'))

  const result = await createLookalikeAudience({
    ...BASE_ARGS,
    name: 'Lookalike',
    sourceSegmentUrn: 'urn:li:dmpSegment:55555',
  })

  const [, init] = (global.fetch as jest.Mock).mock.calls[0]
  const body = JSON.parse(init.body as string)

  expect(body.type).toBe('LOOKALIKE')
  expect(body.sourceSegment).toBe('urn:li:dmpSegment:55555')
  expect(result).toEqual({ urn: 'urn:li:dmpSegment:77777', id: '77777' })
})

// ─── Test 6: createLookalikeAudience rejects invalid URN format ───────────────
it('createLookalikeAudience throws on invalid sourceSegmentUrn format', async () => {
  await expect(
    createLookalikeAudience({
      ...BASE_ARGS,
      name: 'Bad lookalike',
      sourceSegmentUrn: 'not-a-urn',
    }),
  ).rejects.toThrow(/invalid sourceSegmentUrn/)

  expect(global.fetch).not.toHaveBeenCalled()
})

// ─── Test 7: createEngagementAudience body shape ──────────────────────────────
it('createEngagementAudience POSTs engagementSource with organization + engagementType; returns URN', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse('66666'))

  const result = await createEngagementAudience({
    ...BASE_ARGS,
    name: 'Page Visitors',
    organizationUrn: 'urn:li:organization:9999',
    engagementType: 'VISITORS',
  })

  const [, init] = (global.fetch as jest.Mock).mock.calls[0]
  const body = JSON.parse(init.body as string)

  expect(body.type).toBe('COMPANY_PAGE')
  expect(body.engagementSource).toEqual({
    organization: 'urn:li:organization:9999',
    engagementType: 'VISITORS',
  })
  expect(result).toEqual({ urn: 'urn:li:dmpSegment:66666', id: '66666' })
})

// ─── Test 8: createEngagementAudience accepts all 3 engagementType values ─────
it('createEngagementAudience accepts VISITORS / FOLLOWERS / VIDEO_VIEWERS', async () => {
  const types = ['VISITORS', 'FOLLOWERS', 'VIDEO_VIEWERS'] as const

  ;(global.fetch as jest.Mock).mockResolvedValue(makeOkResponse('11111'))

  for (const engagementType of types) {
    await createEngagementAudience({
      ...BASE_ARGS,
      name: `Test ${engagementType}`,
      organizationUrn: 'urn:li:organization:1',
      engagementType,
    })
  }

  expect(global.fetch).toHaveBeenCalledTimes(3)

  const bodies = (global.fetch as jest.Mock).mock.calls.map(([, init]) =>
    JSON.parse(init.body as string),
  )
  expect(bodies[0].engagementSource.engagementType).toBe('VISITORS')
  expect(bodies[1].engagementSource.engagementType).toBe('FOLLOWERS')
  expect(bodies[2].engagementSource.engagementType).toBe('VIDEO_VIEWERS')
})

// ─── Test 9: createAppAudience throws explicit shim error ─────────────────────
it('createAppAudience throws explicit shim-guidance error without calling fetch', async () => {
  await expect(
    createAppAudience({ ...BASE_ARGS, name: 'App Audience' }),
  ).rejects.toThrow('LinkedIn does not support App audiences natively.')

  expect(global.fetch).not.toHaveBeenCalled()
})

// ─── Test 10: getAudienceStatus returns status + count from body ───────────────
it('getAudienceStatus GETs /dmpSegments/{id}; returns status + approximateMemberCount', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => '',
    json: async () => ({ status: 'READY', approximateMemberCount: 1234 }),
  })

  const result = await getAudienceStatus({
    ...BASE_ARGS,
    segmentUrn: 'urn:li:dmpSegment:55555',
  })

  const [url] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/dmpSegments/55555')
  expect(result).toEqual({ status: 'READY', approximateMemberCount: 1234 })
})

// ─── Test 11: getAudienceStatus missing approximateMemberCount → undefined ────
it('getAudienceStatus returns approximateMemberCount: undefined when absent', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => '',
    json: async () => ({ status: 'BUILDING' }),
  })

  const result = await getAudienceStatus({
    ...BASE_ARGS,
    segmentUrn: 'urn:li:dmpSegment:12345',
  })

  expect(result.status).toBe('BUILDING')
  expect(result.approximateMemberCount).toBeUndefined()
})

// ─── Test 12: archiveAudience sends PARTIAL_UPDATE with status ARCHIVED ───────
it('archiveAudience POSTs X-RestLi-Method: PARTIAL_UPDATE + {patch:{$set:{status:"ARCHIVED"}}}', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 204,
    headers: new Headers(),
    text: async () => '',
    json: async () => ({}),
  })

  await archiveAudience({ ...BASE_ARGS, segmentUrn: 'urn:li:dmpSegment:44444' })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/dmpSegments/44444')
  expect(init.method).toBe('POST')

  const headers = init.headers as Record<string, string>
  expect(headers['X-RestLi-Method']).toBe('PARTIAL_UPDATE')

  const body = JSON.parse(init.body as string)
  expect(body).toEqual({ patch: { $set: { status: 'ARCHIVED' } } })
})

// ─── Test 13: URN extraction falls back to Location header ────────────────────
it('createContactListAudience falls back to Location header when X-RestLi-Id absent', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 201,
    headers: new Headers({ Location: '/rest/dmpSegments/33333' }),
    text: async () => '',
    json: async () => ({}),
  })

  const result = await createContactListAudience({ ...BASE_ARGS, name: 'Fallback' })
  expect(result).toEqual({ urn: 'urn:li:dmpSegment:33333', id: '33333' })
})

// ─── Test 14: URN extraction throws when both headers absent ──────────────────
it('createContactListAudience throws when both X-RestLi-Id and Location are absent', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 201,
    headers: new Headers(),
    text: async () => '',
    json: async () => ({}),
  })

  await expect(
    createContactListAudience({ ...BASE_ARGS, name: 'No headers' }),
  ).rejects.toThrow('LinkedIn create response missing both X-RestLi-Id and Location headers')
})

// ─── Test 15: all create calls include required headers ───────────────────────
it('every call includes LinkedIn-Version + X-Restli-Protocol-Version + Bearer auth', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue(makeOkResponse('1'))

  // Test createContactListAudience
  await createContactListAudience({ ...BASE_ARGS, name: 'h1' })

  const [, init] = (global.fetch as jest.Mock).mock.calls[0]
  const headers = init.headers as Record<string, string>

  expect(headers.Authorization).toBe('Bearer test-token')
  expect(headers['LinkedIn-Version']).toBe('202405')
  expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0')
  expect(headers['Content-Type']).toBe('application/json')
})
