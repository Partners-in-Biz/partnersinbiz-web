// __tests__/lib/scoring/icpScore.test.ts

import { computeIcpScore } from '@/lib/scoring/icpScore'
import type { Contact } from '@/lib/crm/types'
import type { Company } from '@/lib/companies/types'
import type { IcpProfile } from '@/lib/scoring/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c-1',
    orgId: 'org-1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    tags: [],
    lastContactedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as unknown as Contact
}

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co-1',
    orgId: 'org-1',
    name: 'Acme Corp',
    tags: [],
    notes: '',
    ...overrides,
  } as Company
}

const FULL_ICP: IcpProfile = {
  industries: ['SaaS'],
  sizes: ['51-200'],
  tiers: ['mid-market'],
  regions: [{ country: 'ZA' }],
  minEmployeeCount: 50,
  maxEmployeeCount: 500,
}

const FULL_COMPANY: Company = makeCompany({
  industry: 'SaaS',
  size: '51-200',
  tier: 'mid-market',
  address: { country: 'ZA' },
  employeeCount: 100,
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeIcpScore', () => {
  it('returns score 0 and empty signals when contact has no company link', () => {
    const contact = makeContact({ companyId: undefined, company: undefined })
    const result = computeIcpScore(contact, null, FULL_ICP)
    expect(result.score).toBe(0)
    expect(result.signals).toEqual({})
  })

  it('returns score 0 when ICP has no criteria configured', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, FULL_COMPANY, {})
    expect(result.score).toBe(0)
    expect(result.signals).toEqual({})
  })

  it('awards 25 pts for industry match', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, FULL_COMPANY, { industries: ['SaaS'] })
    expect(result.signals.industry).toBe(25)
    expect(result.score).toBe(25)
  })

  it('awards 0 pts for industry when no match', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, makeCompany({ industry: 'Retail' }), { industries: ['SaaS'] })
    expect(result.signals.industry).toBe(0)
  })

  it('awards 25 pts for size match', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, FULL_COMPANY, { sizes: ['51-200'] })
    expect(result.signals.size).toBe(25)
  })

  it('awards 20 pts for tier match', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, FULL_COMPANY, { tiers: ['mid-market'] })
    expect(result.signals.tier).toBe(20)
  })

  it('awards 15 pts for region match (country only)', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, FULL_COMPANY, { regions: [{ country: 'ZA' }] })
    expect(result.signals.region).toBe(15)
  })

  it('awards 15 pts for region match (country + state)', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const company = makeCompany({ address: { country: 'US', state: 'CA' } })
    const result = computeIcpScore(contact, company, { regions: [{ country: 'US', state: 'CA' }] })
    expect(result.signals.region).toBe(15)
  })

  it('does NOT award region pts when state does not match', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const company = makeCompany({ address: { country: 'US', state: 'NY' } })
    const result = computeIcpScore(contact, company, { regions: [{ country: 'US', state: 'CA' }] })
    expect(result.signals.region).toBe(0)
  })

  it('awards 15 pts for employeeCount in range', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, FULL_COMPANY, { minEmployeeCount: 50, maxEmployeeCount: 500 })
    expect(result.signals.employeeCount).toBe(15)
  })

  it('awards full 100 pts when all criteria match', () => {
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, FULL_COMPANY, FULL_ICP)
    expect(result.score).toBe(100)
    expect(result.signals.industry).toBe(25)
    expect(result.signals.size).toBe(25)
    expect(result.signals.tier).toBe(20)
    expect(result.signals.region).toBe(15)
    expect(result.signals.employeeCount).toBe(15)
  })

  it('sums only matched criteria', () => {
    // Only industry + size match
    const contact = makeContact({ companyId: 'co-1' })
    const company = makeCompany({ industry: 'SaaS', size: '51-200', tier: 'enterprise' })
    const result = computeIcpScore(contact, company, {
      industries: ['SaaS'],
      sizes: ['51-200'],
      tiers: ['mid-market'],
    })
    expect(result.score).toBe(50) // 25 + 25
    expect(result.signals.tier).toBe(0)
  })

  it('score cannot exceed 100', () => {
    // Edge: all criteria + over-full — the max is 100 by design
    const contact = makeContact({ companyId: 'co-1' })
    const result = computeIcpScore(contact, FULL_COMPANY, FULL_ICP)
    expect(result.score).toBeLessThanOrEqual(100)
  })
})
