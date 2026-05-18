// __tests__/api/v1/ads/experiments/routes.test.ts
// Sub-5 Batch 2A — 10 tests for experiment CRUD + lifecycle routes

import { GET as listGET, POST as createPOST } from '@/app/api/v1/ads/experiments/route'
import { GET as getGET, PATCH, DELETE } from '@/app/api/v1/ads/experiments/[id]/route'
import { POST as startPOST } from '@/app/api/v1/ads/experiments/[id]/start/route'
import { POST as stopPOST } from '@/app/api/v1/ads/experiments/[id]/stop/route'
import { POST as declareWinnerPOST } from '@/app/api/v1/ads/experiments/[id]/declare-winner/route'

// ── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ── Firebase admin mock ──────────────────────────────────────────────────────
const mockUpdate = jest.fn().mockResolvedValue({})
const mockDocFn = jest.fn(() => ({ update: mockUpdate }))
const mockCollectionFn = jest.fn(() => ({ doc: mockDocFn }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollectionFn(...(args as [])),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ seconds: 1000, nanoseconds: 0 }) },
}))

// ── Store mocks ───────────────────────────────────────────────────────────────
const mockListExperiments = jest.fn()
const mockCreateExperiment = jest.fn()
const mockGetExperiment = jest.fn()
const mockUpdateExperiment = jest.fn()
const mockArchiveExperiment = jest.fn()
const mockUpdateExperimentStatus = jest.fn()
const mockListResults = jest.fn()

jest.mock('@/lib/ads/experiments/store', () => ({
  listExperiments: (...args: unknown[]) => mockListExperiments(...args),
  createExperiment: (...args: unknown[]) => mockCreateExperiment(...args),
  getExperiment: (...args: unknown[]) => mockGetExperiment(...args),
  updateExperiment: (...args: unknown[]) => mockUpdateExperiment(...args),
  archiveExperiment: (...args: unknown[]) => mockArchiveExperiment(...args),
  updateExperimentStatus: (...args: unknown[]) => mockUpdateExperimentStatus(...args),
  listResults: (...args: unknown[]) => mockListResults(...args),
  appendResult: jest.fn().mockResolvedValue(undefined),
}))

// ── Start mock ────────────────────────────────────────────────────────────────
const mockGenerateVariantEntities = jest.fn()

jest.mock('@/lib/ads/experiments/start', () => ({
  generateVariantEntities: (...args: unknown[]) => mockGenerateVariantEntities(...args),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ORG = 'org-abc'
const EXP_ID = 'exp_aabbccdd'

const fakeVariants = [
  { id: 'a', name: 'Control', trafficPercent: 50, entityId: 'as_control' },
  { id: 'b', name: 'Variant B', trafficPercent: 50, entityId: 'as_variantb' },
]

const fakeExperiment = {
  id: EXP_ID,
  orgId: ORG,
  name: 'Test Experiment',
  level: 'adset',
  parentEntityId: 'campaign-001',
  sourceEntityId: 'adset-source',
  platform: 'meta',
  variants: fakeVariants,
  successMetric: 'ctr',
  status: 'draft',
  minDays: 7,
  significanceThreshold: 0.05,
  autoWinner: false,
  createdBy: 'user-1',
  createdAt: { seconds: 1000 },
  updatedAt: { seconds: 1000 },
}

const fakeRunningExperiment = {
  ...fakeExperiment,
  status: 'running',
  startedAt: { seconds: 900 },
  significance: {
    pValue: 0.03,
    confident: true,
    winnerVariantId: 'b',
    computedAt: { seconds: 1000 },
  },
}

function makeReq(
  method: string,
  path: string,
  body?: object,
  headers: Record<string, string> = {},
) {
  const url = `http://test.local${path}`
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': ORG, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }) as any
}

function makeCtx(id: string = EXP_ID) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockListExperiments.mockResolvedValue([fakeExperiment])
  mockCreateExperiment.mockResolvedValue(fakeExperiment)
  mockGetExperiment.mockResolvedValue(fakeExperiment)
  mockUpdateExperiment.mockResolvedValue(undefined)
  mockArchiveExperiment.mockResolvedValue(undefined)
  mockUpdateExperimentStatus.mockResolvedValue(undefined)
  mockListResults.mockResolvedValue([])
  mockGenerateVariantEntities.mockResolvedValue({ ...fakeExperiment, variants: fakeVariants })
})

// ── Test 1: GET /experiments lists for org ────────────────────────────────────
describe('GET /api/v1/ads/experiments', () => {
  it('lists experiments for the org', async () => {
    const req = makeReq('GET', '/api/v1/ads/experiments')
    const res = await listGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.experiments).toHaveLength(1)
    expect(mockListExperiments).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG }))
  })

  it('returns 400 when X-Org-Id is missing', async () => {
    const req = new Request('http://test.local/api/v1/ads/experiments', { method: 'GET' }) as any
    const res = await listGET(req)
    expect(res.status).toBe(400)
  })
})

// ── Test 2: POST /experiments creates experiment ───────────────────────────────
describe('POST /api/v1/ads/experiments', () => {
  it('calls createExperiment and returns 201', async () => {
    const input = {
      name: 'Test Exp',
      level: 'adset',
      parentEntityId: 'campaign-001',
      sourceEntityId: 'adset-source',
      platform: 'meta',
      variants: fakeVariants,
      successMetric: 'ctr',
    }
    const req = makeReq('POST', '/api/v1/ads/experiments', { input })
    const res = await createPOST(req, {})
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockCreateExperiment).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, input }))
  })

  // ── Test 3: POST returns 400 on missing required fields ───────────────────
  it('returns 400 on missing required fields', async () => {
    const req = makeReq('POST', '/api/v1/ads/experiments', { input: { name: 'No other fields' } })
    const res = await createPOST(req, {})
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
  })

  it('returns 400 when input is missing', async () => {
    const req = makeReq('POST', '/api/v1/ads/experiments', {})
    const res = await createPOST(req, {})
    expect(res.status).toBe(400)
  })
})

// ── Test 4: GET /[id] returns experiment + results; 404 cross-tenant ──────────
describe('GET /api/v1/ads/experiments/[id]', () => {
  it('returns experiment + results for the correct org', async () => {
    mockListResults.mockResolvedValue([{ variantId: 'a', computedAt: { seconds: 999 } }])
    const req = makeReq('GET', `/api/v1/ads/experiments/${EXP_ID}`)
    const res = await getGET(req, undefined, makeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.experiment.id).toBe(EXP_ID)
    expect(body.data.results).toHaveLength(1)
  })

  it('returns 404 for cross-tenant experiment', async () => {
    mockGetExperiment.mockResolvedValue({ ...fakeExperiment, orgId: 'other-org' })
    const req = makeReq('GET', `/api/v1/ads/experiments/${EXP_ID}`)
    const res = await getGET(req, undefined, makeCtx())
    expect(res.status).toBe(404)
  })
})

// ── Test 5: PATCH /[id] updates non-variant fields when running ───────────────
describe('PATCH /api/v1/ads/experiments/[id]', () => {
  it('updates non-variant fields when running', async () => {
    mockGetExperiment
      .mockResolvedValueOnce({ ...fakeRunningExperiment })
      .mockResolvedValueOnce({ ...fakeRunningExperiment, name: 'Updated Name' })
    const req = makeReq('PATCH', `/api/v1/ads/experiments/${EXP_ID}`, { name: 'Updated Name' })
    const res = await PATCH(req, undefined, makeCtx())
    expect(res.status).toBe(200)
    expect(mockUpdateExperiment).toHaveBeenCalledWith(EXP_ID, { name: 'Updated Name' })
  })

  // ── Test 6: PATCH /[id] rejects variants change when running ─────────────
  it('rejects variants change when running', async () => {
    mockGetExperiment.mockResolvedValue({ ...fakeRunningExperiment })
    const req = makeReq('PATCH', `/api/v1/ads/experiments/${EXP_ID}`, { variants: fakeVariants })
    const res = await PATCH(req, undefined, makeCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/draft/i)
    expect(mockUpdateExperiment).not.toHaveBeenCalled()
  })
})

// ── Test 7: DELETE /[id] archives ─────────────────────────────────────────────
describe('DELETE /api/v1/ads/experiments/[id]', () => {
  it('archives the experiment', async () => {
    const req = makeReq('DELETE', `/api/v1/ads/experiments/${EXP_ID}`)
    const res = await DELETE(req, undefined, makeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.archived).toBe(true)
    expect(mockArchiveExperiment).toHaveBeenCalledWith(EXP_ID)
  })
})

// ── Test 8: POST /[id]/start ──────────────────────────────────────────────────
describe('POST /api/v1/ads/experiments/[id]/start', () => {
  it('requires status=draft, populates entityIds, flips to running', async () => {
    const updatedWithEntities = {
      ...fakeExperiment,
      status: 'running',
      startedAt: { seconds: 1000 },
    }
    // getExperiment calls: initial load, then post-update reload
    mockGetExperiment
      .mockResolvedValueOnce(fakeExperiment)   // initial load
      .mockResolvedValueOnce(updatedWithEntities) // reload after start

    const req = makeReq('POST', `/api/v1/ads/experiments/${EXP_ID}/start`)
    const res = await startPOST(req, undefined, makeCtx())
    expect(res.status).toBe(200)
    expect(mockGenerateVariantEntities).toHaveBeenCalledWith({ experiment: fakeExperiment })
    expect(mockUpdate).toHaveBeenCalled()
    expect(mockUpdateExperimentStatus).toHaveBeenCalledWith(EXP_ID, 'running', expect.objectContaining({ startedAt: expect.anything() }))
  })

  it('returns 400 when experiment is not draft', async () => {
    mockGetExperiment.mockResolvedValue({ ...fakeExperiment, status: 'running' })
    const req = makeReq('POST', `/api/v1/ads/experiments/${EXP_ID}/start`)
    const res = await startPOST(req, undefined, makeCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/draft/i)
  })
})

// ── Test 9: POST /[id]/stop ───────────────────────────────────────────────────
describe('POST /api/v1/ads/experiments/[id]/stop', () => {
  it('flips running experiment to paused', async () => {
    mockGetExperiment
      .mockResolvedValueOnce(fakeRunningExperiment)
      .mockResolvedValueOnce({ ...fakeRunningExperiment, status: 'paused' })
    const req = makeReq('POST', `/api/v1/ads/experiments/${EXP_ID}/stop`)
    const res = await stopPOST(req, undefined, makeCtx())
    expect(res.status).toBe(200)
    expect(mockUpdateExperimentStatus).toHaveBeenCalledWith(EXP_ID, 'paused')
  })

  it('returns 400 when experiment is not running', async () => {
    mockGetExperiment.mockResolvedValue({ ...fakeExperiment, status: 'paused' })
    const req = makeReq('POST', `/api/v1/ads/experiments/${EXP_ID}/stop`)
    const res = await stopPOST(req, undefined, makeCtx())
    expect(res.status).toBe(400)
  })
})

// ── Test 10: POST /[id]/declare-winner ────────────────────────────────────────
describe('POST /api/v1/ads/experiments/[id]/declare-winner', () => {
  it('pauses non-winning entities and flips to winner_declared', async () => {
    mockGetExperiment
      .mockResolvedValueOnce(fakeRunningExperiment)
      .mockResolvedValueOnce({ ...fakeRunningExperiment, status: 'winner_declared', declaredWinnerVariantId: 'b' })

    const req = makeReq('POST', `/api/v1/ads/experiments/${EXP_ID}/declare-winner`, { variantId: 'b' })
    const res = await declareWinnerPOST(req, undefined, makeCtx())
    expect(res.status).toBe(200)

    // Variant 'a' (non-winner with entityId 'as_control') should be paused
    expect(mockCollectionFn).toHaveBeenCalledWith('ad_sets')
    expect(mockDocFn).toHaveBeenCalledWith('as_control')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED' }))

    // Experiment should be flipped to winner_declared
    expect(mockUpdateExperimentStatus).toHaveBeenCalledWith(
      EXP_ID,
      'winner_declared',
      expect.objectContaining({ declaredWinnerVariantId: 'b' }),
    )
  })

  it('returns 400 when experiment is not running', async () => {
    mockGetExperiment.mockResolvedValue({ ...fakeExperiment, status: 'draft', significance: { pValue: 0.03, confident: true, winnerVariantId: 'b', computedAt: { seconds: 1000 } } })
    const req = makeReq('POST', `/api/v1/ads/experiments/${EXP_ID}/declare-winner`, { variantId: 'b' })
    const res = await declareWinnerPOST(req, undefined, makeCtx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/running/i)
  })

  it('returns 400 when significance not computed', async () => {
    mockGetExperiment.mockResolvedValue({ ...fakeRunningExperiment, significance: undefined })
    const req = makeReq('POST', `/api/v1/ads/experiments/${EXP_ID}/declare-winner`, { variantId: 'b' })
    const res = await declareWinnerPOST(req, undefined, makeCtx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/significance/i)
  })
})
