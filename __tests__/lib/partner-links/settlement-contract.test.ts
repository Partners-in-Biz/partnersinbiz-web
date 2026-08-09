import {
  resolveSettlementIdempotency,
  validateCanonicalSettlementPair,
} from '@/lib/partner-links/settlement-contract'

const ORDER_TERMS = 'sha256:trade-terms-v1'

function canonicalFixture(overrides: {
  invoice?: Record<string, unknown>
  orders?: Array<Record<string, unknown>>
  relationships?: Array<Record<string, unknown>>
} = {}) {
  const invoice = {
    orgId: 'org-supplier',
    issuerOrgId: 'org-supplier',
    recipientOrgId: 'org-buyer',
    tradeOrderId: 'trade-1',
    partnerLinkId: 'link-1',
    supplierOrderId: 'sales-1',
    buyerOrderId: 'purchase-1',
    tradeTermsHash: ORDER_TERMS,
    ...overrides.invoice,
  }
  const orders = overrides.orders ?? [
    {
      id: 'sales-1', orgId: 'org-supplier', counterpartyOrgId: 'org-buyer',
      direction: 'sales', counterpartOrderId: 'purchase-1',
      tradeOrderId: 'trade-1', partnerLinkId: 'link-1', termsHash: ORDER_TERMS, deleted: false,
    },
    {
      id: 'purchase-1', orgId: 'org-buyer', counterpartyOrgId: 'org-supplier',
      direction: 'purchase', counterpartOrderId: 'sales-1',
      tradeOrderId: 'trade-1', partnerLinkId: 'link-1', termsHash: ORDER_TERMS, deleted: false,
    },
  ]
  const relationships = overrides.relationships ?? [
    { id: 'rel-sales', sourceOrgId: 'org-supplier', targetOrgId: 'org-buyer', partnerLinkId: 'link-1', status: 'active', deleted: false },
    { id: 'rel-purchase', sourceOrgId: 'org-buyer', targetOrgId: 'org-supplier', partnerLinkId: 'link-1', status: 'active', deleted: false },
  ]
  return { invoice, orders, relationships }
}

describe('canonical partner settlement contract', () => {
  it('accepts only a complete reciprocal pair that exactly binds the invoice', () => {
    const result = validateCanonicalSettlementPair(canonicalFixture())
    expect(result).toEqual({
      partnerLinkId: 'link-1',
      tradeOrderId: 'trade-1',
      issuerOrgId: 'org-supplier',
      recipientOrgId: 'org-buyer',
      supplierOrderId: 'sales-1',
      buyerOrderId: 'purchase-1',
      tradeTermsHash: ORDER_TERMS,
    })
  })

  it.each([
    ['legacy issuer fallback', { invoice: { issuerOrgId: undefined } }],
    ['legacy linked-org relationship fallback', { relationships: [
      { sourceOrgId: 'org-supplier', targetOrgId: 'org-buyer', partnerLinkId: 'link-1', status: 'active', deleted: false },
      { sourceOrgId: 'org-buyer', targetOrgId: 'org-unrelated', partnerLinkId: 'link-1', status: 'active', deleted: false },
    ] }],
    ['missing reciprocal order', { orders: [canonicalFixture().orders[0]] }],
    ['three order rows', { orders: [...canonicalFixture().orders, { ...canonicalFixture().orders[1], id: 'extra' }] }],
    ['mismatched order link', { orders: [{ ...canonicalFixture().orders[0], partnerLinkId: 'other-link' }, canonicalFixture().orders[1]] }],
    ['mismatched immutable terms', { invoice: { tradeTermsHash: 'sha256:tampered' } }],
    ['invoice points at a different buyer order', { invoice: { buyerOrderId: 'wrong-order' } }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => validateCanonicalSettlementPair(canonicalFixture(overrides))).toThrow(/canonical partner settlement/i)
  })

  it('allows only exact duplicate transition retries, never a reused key with different intent', () => {
    const existing = {
      operation: 'notice',
      idempotencyKey: 'notice-1',
      fingerprint: 'same-request',
      resultState: 'pending_verification',
    }

    expect(resolveSettlementIdempotency(existing, {
      operation: 'notice', idempotencyKey: 'notice-1', fingerprint: 'same-request',
    })).toEqual({ replay: true, resultState: 'pending_verification' })

    expect(() => resolveSettlementIdempotency(existing, {
      operation: 'notice', idempotencyKey: 'notice-1', fingerprint: 'tampered-request',
    })).toThrow(/idempotency key/i)
    expect(resolveSettlementIdempotency(existing, {
      operation: 'confirm', idempotencyKey: 'confirm-1', fingerprint: 'confirm',
    })).toEqual({ replay: false })
  })
})
