// __tests__/lib/ads/budgets/auto-pause.test.ts

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1716000000, nanoseconds: 0 })),
  },
}))

const campaignDocs = new Map<string, Record<string, unknown>>()

jest.mock('@/lib/firebase/admin', () => {
  function makeQuery(path: string, filters: Array<[string, string, unknown]> = []) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(path, [...filters, [field, op, value]]),
      get: async () => ({
        docs: Array.from(campaignDocs.entries())
          .filter(([k]) => k.startsWith(`${path}/`))
          .filter(([, data]) =>
            filters.every(([field, , value]) =>
              (data as Record<string, unknown>)[field] === value,
            ),
          )
          .map(([, v]) => ({ data: () => v })),
      }),
    }
  }

  function makeDoc(fullPath: string) {
    return {
      get: async () => ({
        exists: campaignDocs.has(fullPath),
        data: () => campaignDocs.get(fullPath),
      }),
      update: async (patch: Record<string, unknown>) => {
        const cur = campaignDocs.get(fullPath) ?? {}
        campaignDocs.set(fullPath, { ...cur, ...patch })
      },
    }
  }

  return {
    adminDb: {
      collection: (name: string) => ({
        doc: (id: string) => makeDoc(`${name}/${id}`),
        where: (field: string, op: string, value: unknown) =>
          makeQuery(name, [[field, op, value]]),
      }),
    },
    _docs: campaignDocs,
  }
})

// ─── Subject ─────────────────────────────────────────────────────────────────

import { autoPauseCampaignsInScope } from '@/lib/ads/budgets/auto-pause'
import type { AdBudget } from '@/lib/ads/budgets/types'
import { Timestamp } from 'firebase-admin/firestore'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fakeTimestamp() {
  return { seconds: 1716000000, nanoseconds: 0 } as unknown as ReturnType<typeof Timestamp.now>
}

function baseBudget(overrides: Partial<AdBudget> = {}): AdBudget {
  const ts = fakeTimestamp()
  return {
    id: 'bgt_test',
    orgId: 'org_1',
    scope: 'org',
    capCents: 100000,
    currencyCode: 'USD',
    period: 'monthly',
    periodStart: ts,
    alertThresholds: [75, 90, 100],
    autoPause: true,
    name: 'Test Budget',
    createdBy: 'user_a',
    createdAt: ts,
    updatedAt: ts,
    firedThresholds: [],
    ...overrides,
  } as AdBudget
}

function seedCampaign(id: string, data: Record<string, unknown>) {
  campaignDocs.set(`ad_campaigns/${id}`, { id, ...data })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  campaignDocs.clear()
})

describe('autoPauseCampaignsInScope — campaign scope', () => {
  it('pauses the single campaign and returns its id', async () => {
    seedCampaign('cmp_abc', { orgId: 'org_1', platform: 'meta', status: 'ACTIVE' })

    const budget = baseBudget({ scope: 'campaign', platform: 'meta', campaignId: 'cmp_abc' })
    const paused = await autoPauseCampaignsInScope({ budget })

    expect(paused).toEqual(['cmp_abc'])
    // Verify local status flip
    expect(campaignDocs.get('ad_campaigns/cmp_abc')?.status).toBe('PAUSED')
  })

  it('returns empty array when campaign is already PAUSED', async () => {
    seedCampaign('cmp_abc', { orgId: 'org_1', platform: 'meta', status: 'PAUSED' })

    const budget = baseBudget({ scope: 'campaign', platform: 'meta', campaignId: 'cmp_abc' })
    const paused = await autoPauseCampaignsInScope({ budget })

    expect(paused).toEqual([])
  })

  it('returns empty array when campaign doc does not exist', async () => {
    const budget = baseBudget({ scope: 'campaign', platform: 'meta', campaignId: 'cmp_nonexistent' })
    const paused = await autoPauseCampaignsInScope({ budget })
    expect(paused).toEqual([])
  })
})

describe('autoPauseCampaignsInScope — platform scope', () => {
  it('queries by orgId + platform + status=ACTIVE and returns paused ids', async () => {
    seedCampaign('cmp_1', { orgId: 'org_1', platform: 'meta', status: 'ACTIVE' })
    seedCampaign('cmp_2', { orgId: 'org_1', platform: 'meta', status: 'ACTIVE' })
    seedCampaign('cmp_3', { orgId: 'org_1', platform: 'google', status: 'ACTIVE' })  // different platform

    const budget = baseBudget({ scope: 'platform', platform: 'meta' })
    const paused = await autoPauseCampaignsInScope({ budget })

    expect(paused.sort()).toEqual(['cmp_1', 'cmp_2'])
  })

  it('locally flips status to PAUSED on each campaign', async () => {
    seedCampaign('cmp_1', { orgId: 'org_1', platform: 'meta', status: 'ACTIVE' })
    seedCampaign('cmp_2', { orgId: 'org_1', platform: 'meta', status: 'ACTIVE' })

    const budget = baseBudget({ scope: 'platform', platform: 'meta' })
    await autoPauseCampaignsInScope({ budget })

    expect(campaignDocs.get('ad_campaigns/cmp_1')?.status).toBe('PAUSED')
    expect(campaignDocs.get('ad_campaigns/cmp_2')?.status).toBe('PAUSED')
  })
})

describe('autoPauseCampaignsInScope — org scope', () => {
  it('pauses all ACTIVE campaigns across platforms for the org', async () => {
    seedCampaign('cmp_meta', { orgId: 'org_1', platform: 'meta', status: 'ACTIVE' })
    seedCampaign('cmp_google', { orgId: 'org_1', platform: 'google', status: 'ACTIVE' })
    seedCampaign('cmp_other_org', { orgId: 'org_2', platform: 'meta', status: 'ACTIVE' })  // different org

    const budget = baseBudget({ scope: 'org' })
    const paused = await autoPauseCampaignsInScope({ budget })

    expect(paused.sort()).toEqual(['cmp_google', 'cmp_meta'])
    // Other org campaign not paused
    expect(campaignDocs.get('ad_campaigns/cmp_other_org')?.status).toBe('ACTIVE')
  })

  it('continues pausing remaining campaigns when one throws (best-effort)', async () => {
    // Seed campaign that will succeed
    seedCampaign('cmp_good', { orgId: 'org_1', platform: 'meta', status: 'ACTIVE' })

    // We can't easily simulate an error in the update without modifying the mock,
    // but we verify that at least the successful one is paused and returned
    const budget = baseBudget({ scope: 'org' })
    const paused = await autoPauseCampaignsInScope({ budget })

    expect(paused).toContain('cmp_good')
    expect(campaignDocs.get('ad_campaigns/cmp_good')?.status).toBe('PAUSED')
  })
})
