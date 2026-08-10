import {
  isCanonicalPartnerTradeInvoice,
  isCanonicalPartnerTradeOrder,
  rejectGenericPartnerTradeMutation,
  rejectGenericPartnerTradeOrderMutation,
} from '@/lib/partner-links/invoice-guard'
import {
  financialTermsHash,
  resolveSettlementIdempotency,
  validateCanonicalSettlementAuthority,
  validateCanonicalSettlementPair,
} from '@/lib/partner-links/settlement-contract'

const ORDER_TERMS = 'sha256:trade-terms-v1'

function canonicalFixture(overrides: {
  invoice?: Record<string, unknown>
  orders?: Array<Record<string, unknown>>
  relationships?: Array<Record<string, unknown>>
} = {}) {
  const invoice: Record<string, unknown> = {
    orgId: 'org-supplier',
    issuerOrgId: 'org-supplier',
    recipientOrgId: 'org-buyer',
    tradeOrderId: 'trade-1',
    partnerLinkId: 'link-1',
    supplierOrderId: 'sales-1',
    buyerOrderId: 'purchase-1',
    tradeTermsHash: ORDER_TERMS,
    total: 125,
    currency: 'ZAR',
    lineItems: [{ productId: 'widget', description: 'Widget', quantity: 1, unitPrice: 100, amount: 100 }],
    ...overrides.invoice,
  }
  const orders = overrides.orders ?? [
    {
      id: 'sales-1', orgId: 'org-supplier', counterpartyOrgId: 'org-buyer',
      direction: 'sales', counterpartOrderId: 'purchase-1',
      tradeOrderId: 'trade-1', partnerLinkId: 'link-1', termsHash: ORDER_TERMS, deleted: false,
      total: 125, currency: 'ZAR', lineItems: [{ productId: 'widget', name: 'Widget', qty: 1, unitPrice: 100, total: 100 }],
    },
    {
      id: 'purchase-1', orgId: 'org-buyer', counterpartyOrgId: 'org-supplier',
      direction: 'purchase', counterpartOrderId: 'sales-1',
      tradeOrderId: 'trade-1', partnerLinkId: 'link-1', termsHash: ORDER_TERMS, deleted: false,
      total: 125, currency: 'ZAR', lineItems: [{ productId: 'widget', name: 'Widget', qty: 1, unitPrice: 100, total: 100 }],
    },
  ]
  const relationships = overrides.relationships ?? [
    { id: 'rel-sales', sourceOrgId: 'org-supplier', targetOrgId: 'org-buyer', partnerLinkId: 'link-1', status: 'active', deleted: false },
    { id: 'rel-purchase', sourceOrgId: 'org-buyer', targetOrgId: 'org-supplier', partnerLinkId: 'link-1', status: 'active', deleted: false },
  ]
  const hash = financialTermsHash(invoice)
  invoice.tradeFinancialHash = hash
  for (const order of orders) order.tradeFinancialHash = hash
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
    ['invoice financial total differs from the supplier order', { invoice: { total: 126 } }],
    ['invoice has same total but different line composition', { invoice: { lineItems: [{ productId: 'other-widget', description: 'Other', quantity: 1, unitPrice: 100, amount: 100 }] } }],
    ['invoice points at a different buyer order', { invoice: { buyerOrderId: 'wrong-order' } }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => validateCanonicalSettlementPair(canonicalFixture(overrides))).toThrow(/canonical partner settlement/i)
  })

  it('rejects every generic mutation of a canonical partner-trade invoice', () => {
    const { invoice } = canonicalFixture()
    expect(isCanonicalPartnerTradeInvoice(invoice)).toBe(true)
    expect(rejectGenericPartnerTradeMutation(invoice)).toMatch(/partner settlement flow/i)
    expect(rejectGenericPartnerTradeMutation({ partnerLinkId: 'link-1' })).toBeNull()
  })

  it('rejects generic mutations of a canonical partner-trade order', () => {
    const order = canonicalFixture().orders[0]
    expect(isCanonicalPartnerTradeOrder(order)).toBe(true)
    expect(rejectGenericPartnerTradeOrderMutation(order)).toMatch(/partner settlement flow/i)
    expect(isCanonicalPartnerTradeOrder({ partnerLinkId: 'link-1' })).toBe(false)
  })

  it('requires an active canonical partner link and non-expired bilateral invoice scope', () => {
    const pair = validateCanonicalSettlementPair(canonicalFixture())
    const authority = {
      link: { id: 'link-1', partnerLinkId: 'link-1', orgA: 'org-supplier', orgB: 'org-buyer', status: 'active' },
      scope: {
        id: 'scope-1', partnerLinkId: 'link-1', status: 'active',
        direction: { grantorOrgId: 'org-supplier', granteeOrgId: 'org-buyer' },
        capabilities: ['invoices'],
        acceptance: { grantor: { byRef: { uid: 'supplier', kind: 'human', displayName: 'Supplier' } }, grantee: { byRef: { uid: 'buyer', kind: 'human', displayName: 'Buyer' } } },
      },
    }
    expect(() => validateCanonicalSettlementAuthority({ pair, ...authority, now: new Date('2026-08-09T12:00:00Z') })).not.toThrow()
    expect(() => validateCanonicalSettlementAuthority({
      pair, ...authority, link: { ...authority.link, status: 'revoked' }, now: new Date('2026-08-09T12:00:00Z'),
    })).toThrow(/canonical partner link/i)
    expect(() => validateCanonicalSettlementAuthority({
      pair, ...authority, scope: { ...authority.scope, expiresAt: '2026-08-09T11:59:59Z' }, now: new Date('2026-08-09T12:00:00Z'),
    })).toThrow(/directional invoices/i)
    expect(() => validateCanonicalSettlementAuthority({
      pair, ...authority, scope: { ...authority.scope, acceptance: { grantor: authority.scope.acceptance.grantor } }, now: new Date('2026-08-09T12:00:00Z'),
    })).toThrow(/directional invoices/i)
  })

  it('recognizes only fully linked partner-trade invoices as generic-route immutable', () => {
    const invoice = canonicalFixture().invoice
    expect(isCanonicalPartnerTradeInvoice(invoice)).toBe(true)
    expect(rejectGenericPartnerTradeMutation(invoice)).toMatch(/partner-trade invoices/i)
    expect(isCanonicalPartnerTradeInvoice({ partnerLinkId: 'link-1' })).toBe(false)
    expect(rejectGenericPartnerTradeMutation({ partnerLinkId: 'link-1' })).toBeNull()
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
