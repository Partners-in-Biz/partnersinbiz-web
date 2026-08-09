jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (minRole: string, handler: Function) =>
    (req: Request, routeCtx?: unknown) => {
      const { NextResponse } = require('next/server')
      const role = (req as Request & { _testRole?: string })._testRole ?? minRole
      if (minRole === 'admin' && role === 'member') {
        return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
      }
      const isAgent = role === 'agent'
      return handler(req, {
        orgId: 'org-a',
        role,
        isAgent,
        actor: isAgent
          ? { uid: 'agent:pip', displayName: 'Pip', kind: 'agent' }
          : { uid: 'admin-1', displayName: 'Admin One', kind: 'human' },
        permissions: {},
      }, routeCtx)
    },
}))

jest.mock('@/lib/partner-links/trade', () => ({
  cancelPartnerOrder: jest.fn(),
  decidePartnerOrder: jest.fn(),
  fulfilPartnerOrder: jest.fn(),
  placePartnerOrder: jest.fn(),
  listPartnerOrders: jest.fn(),
}))

import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/v1/crm/partner-orders/[id]/route'
import { POST } from '@/app/api/v1/crm/partner-orders/route'
import {
  cancelPartnerOrder,
  decidePartnerOrder,
  fulfilPartnerOrder,
  placePartnerOrder,
} from '@/lib/partner-links/trade'

const mockCancel = cancelPartnerOrder as jest.Mock
const mockDecide = decidePartnerOrder as jest.Mock
const mockFulfil = fulfilPartnerOrder as jest.Mock
const mockPlace = placePartnerOrder as jest.Mock

function makeReq(url: string, body: unknown, role = 'member'): [NextRequest, { params: Promise<{ id: string }> }] {
  const req = new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
  })
  ;(req as NextRequest & { _testRole?: string })._testRole = role
  return [req, { params: Promise.resolve({ id: 'order-1' }) }]
}

function makePostReq(url: string, body: unknown, role = 'member', idempotencyKey = 'order-idempotency-1'): NextRequest {
  const req = new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test', 'Idempotency-Key': idempotencyKey },
  })
  ;(req as NextRequest & { _testRole?: string })._testRole = role
  return req
}

describe('PATCH /api/v1/crm/partner-orders/[id] — partial shipment contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFulfil.mockResolvedValue({ tradeOrderId: 'trade-1', fulfillmentStatus: 'packed', shipmentIds: ['s1', 's2'] })
    mockDecide.mockResolvedValue({ tradeOrderId: 'trade-1', status: 'confirmed', reservedInventoryIds: [], invoiceId: 'inv-1' })
    mockCancel.mockResolvedValue({ tradeOrderId: 'trade-1', releasedInventoryIds: [] })
  })

  it('forwards a validated quantities map to fulfilPartnerOrder for ship', async () => {
    const [req, ctx] = makeReq('http://localhost/api/v1/crm/partner-orders/order-1', {
      action: 'ship',
      quantities: { 'prod-1': 2, 'prod-2': 1 },
      trackingNumber: 'TRK-9',
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(200)
    expect(mockFulfil).toHaveBeenCalledWith(expect.objectContaining({
      supplierOrgId: 'org-a',
      orderId: 'order-1',
      action: 'ship',
      quantities: { 'prod-1': 2, 'prod-2': 1 },
      trackingNumber: 'TRK-9',
    }))
  })

  it('rejects a non-object quantities payload with 400 before the service is called', async () => {
    const [req, ctx] = makeReq('http://localhost/api/v1/crm/partner-orders/order-1', {
      action: 'ship',
      quantities: [2, 3],
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(400)
    expect(mockFulfil).not.toHaveBeenCalled()
  })

  it('rejects a non-positive quantity with 400', async () => {
    const [req, ctx] = makeReq('http://localhost/api/v1/crm/partner-orders/order-1', {
      action: 'ship',
      quantities: { 'prod-1': 0, 'prod-2': -3 },
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(400)
    expect(mockFulfil).not.toHaveBeenCalled()
  })

  it('rejects a NaN quantity with 400', async () => {
    const [req, ctx] = makeReq('http://localhost/api/v1/crm/partner-orders/order-1', {
      action: 'ship',
      quantities: { 'prod-1': 'abc' },
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(400)
    expect(mockFulfil).not.toHaveBeenCalled()
  })

  it('omits quantities entirely when not supplied (full shipment)', async () => {
    const [req, ctx] = makeReq('http://localhost/api/v1/crm/partner-orders/order-1', {
      action: 'ship',
      trackingNumber: 'FULL-1',
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(200)
    expect(mockFulfil).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ship',
      quantities: undefined,
    }))
  })

  it('still routes confirm and cancel decisions', async () => {
    const [req1, ctx1] = makeReq('http://localhost/api/v1/crm/partner-orders/order-1', { decision: 'confirm' })
    await PATCH(req1, ctx1)
    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'confirm' }))
    const [req2, ctx2] = makeReq('http://localhost/api/v1/crm/partner-orders/order-1', { action: 'cancel' })
    await PATCH(req2, ctx2)
    expect(mockCancel).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-a', orderId: 'order-1' }))
  })
})

describe('POST /api/v1/crm/partner-orders — duplicate line rejection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlace.mockResolvedValue({ tradeOrderId: 'trade-1', buyerOrderId: 'b1', supplierOrderId: 's1', total: 100, currency: 'ZAR' })
  })

  it('rejects duplicate catalogue items in one order', async () => {
    const req = makePostReq('http://localhost/api/v1/crm/partner-orders', {
      relationshipId: 'rel-1',
      lines: [
        { catalogItemId: 'cat-1', qty: 2 },
        { catalogItemId: 'cat-1', qty: 3 },
      ],
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(mockPlace).not.toHaveBeenCalled()
  })

  it('accepts distinct catalogue items', async () => {
    const req = makePostReq('http://localhost/api/v1/crm/partner-orders', {
      relationshipId: 'rel-1',
      lines: [
        { catalogItemId: 'cat-1', qty: 2 },
        { catalogItemId: 'cat-2', qty: 3 },
      ],
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(mockPlace).toHaveBeenCalledWith(expect.objectContaining({
      buyerOrgId: 'org-a',
      relationshipId: 'rel-1',
      lines: [
        { catalogItemId: 'cat-1', qty: 2 },
        { catalogItemId: 'cat-2', qty: 3 },
      ],
      idempotencyKey: 'order-idempotency-1',
    }))
  })

  it('rejects a missing Idempotency-Key before placing an order', async () => {
    const req = makePostReq('http://localhost/api/v1/crm/partner-orders', {
      relationshipId: 'rel-1', lines: [{ catalogItemId: 'cat-1', qty: 1 }],
    }, 'member', '')
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(mockPlace).not.toHaveBeenCalled()
  })
})
