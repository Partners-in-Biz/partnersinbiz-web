// __tests__/lib/ads/providers/linkedin/saved-audiences.test.ts
// 3 tests for Phase 3 Batch 2A LinkedIn Audience Templates (Saved Audiences).

import {
  createSavedAudience,
  archiveSavedAudience,
} from '@/lib/ads/providers/linkedin/saved-audiences'
import type { LinkedinTargetingCriteria } from '@/lib/ads/providers/linkedin/types'

const BASE_ARGS = {
  accountUrn: 'urn:li:sponsoredAccount:222',
  accessToken: 'sa-token',
}

const SAMPLE_TARGETING: LinkedinTargetingCriteria = {
  include: {
    and: [
      { or: { 'urn:li:adTargetingFacet:titles': ['urn:li:title:100'] } },
    ],
  },
  exclude: {
    or: { 'urn:li:adTargetingFacet:locations': ['urn:li:geo:101'] },
  },
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers({ 'X-RestLi-Id': '55555' }),
    text: async () => '',
    json: async () => ({}),
  })
})

afterEach(() => {
  ;(global.fetch as jest.Mock).mockRestore?.()
})

// ─── Test 1: createSavedAudience POSTs to /adTargetingTemplates ───────────────
it('createSavedAudience POSTs to /adTargetingTemplates with account + name + targeting; returns adTargetingTemplate URN', async () => {
  const result = await createSavedAudience({
    ...BASE_ARGS,
    name: 'Decision Makers',
    targeting: SAMPLE_TARGETING,
  })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://api.linkedin.com/rest/adTargetingTemplates')
  expect(init.method).toBe('POST')

  const body = JSON.parse(init.body as string)
  expect(body.account).toBe('urn:li:sponsoredAccount:222')
  expect(body.name).toBe('Decision Makers')
  expect(body.includedTargetingFacets).toEqual(SAMPLE_TARGETING.include)
  expect(body.excludedTargetingFacets).toEqual(SAMPLE_TARGETING.exclude)

  // URN namespace must be adTargetingTemplate
  expect(result).toEqual({ urn: 'urn:li:adTargetingTemplate:55555', id: '55555' })
})

// ─── Test 2: archiveSavedAudience sends PARTIAL_UPDATE with status ARCHIVED ───
it('archiveSavedAudience POSTs X-RestLi-Method: PARTIAL_UPDATE + status ARCHIVED patch', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 204,
    headers: new Headers(),
    text: async () => '',
    json: async () => ({}),
  })

  await archiveSavedAudience({
    ...BASE_ARGS,
    templateUrn: 'urn:li:adTargetingTemplate:99999',
  })

  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toContain('/adTargetingTemplates/99999')
  expect(init.method).toBe('POST')

  const headers = init.headers as Record<string, string>
  expect(headers['X-RestLi-Method']).toBe('PARTIAL_UPDATE')

  const body = JSON.parse(init.body as string)
  expect(body).toEqual({ patch: { $set: { status: 'ARCHIVED' } } })
})

// ─── Test 3: both helpers throw on non-OK HTTP ────────────────────────────────
it('createSavedAudience and archiveSavedAudience both throw on non-OK HTTP', async () => {
  const errorResponse = {
    ok: false,
    status: 403,
    headers: new Headers(),
    text: async () => 'Forbidden',
    json: async () => ({}),
  }

  // createSavedAudience
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(errorResponse)
  await expect(
    createSavedAudience({ ...BASE_ARGS, name: 'Err', targeting: SAMPLE_TARGETING }),
  ).rejects.toThrow(/LinkedIn saved audience create failed: HTTP 403/)

  // archiveSavedAudience — mock a non-204 error (status 500)
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 500,
    headers: new Headers(),
    text: async () => 'Server Error',
    json: async () => ({}),
  })
  await expect(
    archiveSavedAudience({ ...BASE_ARGS, templateUrn: 'urn:li:adTargetingTemplate:12345' }),
  ).rejects.toThrow(/LinkedIn archive saved audience failed: HTTP 500/)
})
