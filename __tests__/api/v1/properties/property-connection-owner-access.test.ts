import { NextRequest } from 'next/server'

const restrictedUser = {
  uid: 'restricted-admin',
  role: 'admin' as const,
  allowedOrgIds: ['org-owned'],
  orgId: 'org-owned',
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: jest.fn((_role, handler) => (req: NextRequest, context: unknown) => handler(req, restrictedUser, context)),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(() => false),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/integrations/bootstrap', () => ({}))
jest.mock('@/lib/integrations/connections', () => ({
  listConnectionsForProperty: jest.fn(),
  getConnection: jest.fn(),
  upsertConnection: jest.fn(),
  setConnectionStatus: jest.fn(),
  deleteConnection: jest.fn(),
  markPullSuccess: jest.fn(),
  markPullFailure: jest.fn(),
}))
jest.mock('@/lib/integrations/registry', () => ({ getAdapter: jest.fn() }))
jest.mock('@/lib/integrations/dispatch', () => ({ dispatchOne: jest.fn() }))

import { adminDb } from '@/lib/firebase/admin'
import {
  listConnectionsForProperty,
  getConnection,
  setConnectionStatus,
  deleteConnection,
} from '@/lib/integrations/connections'
import { getAdapter } from '@/lib/integrations/registry'
import { dispatchOne } from '@/lib/integrations/dispatch'
import { GET as listConnections } from '@/app/api/v1/properties/[id]/connections/route'
import {
  GET as getConnectionRoute,
  PUT as putConnection,
  PATCH as patchConnection,
  DELETE as deleteConnectionRoute,
} from '@/app/api/v1/properties/[id]/connections/[provider]/route'
import { GET as authorizeConnection } from '@/app/api/v1/properties/[id]/connections/[provider]/authorize/route'
import { POST as backfillConnection } from '@/app/api/v1/properties/[id]/connections/[provider]/backfill/route'
import { POST as pullConnection } from '@/app/api/v1/properties/[id]/connections/[provider]/pull/route'

const propertyContext = { params: Promise.resolve({ id: 'property-foreign' }) }
const providerContext = { params: Promise.resolve({ id: 'property-foreign', provider: 'ga4' }) }

function request(path: string, method = 'GET', body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
}

function configureForeignProperty() {
  const propertyDoc = {
    exists: true,
    id: 'property-foreign',
    data: () => ({ orgId: 'org-foreign', deleted: false }),
  }
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'properties') {
      return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue(propertyDoc) })) }
    }
    return { doc: jest.fn(() => ({ set: jest.fn().mockResolvedValue(undefined) })) }
  })
}

async function expectDenied(
  handler: (req: NextRequest, context: unknown) => Promise<Response>,
  req: NextRequest,
  context: unknown,
) {
  const response = await handler(req, context)
  expect(response.status).toBe(403)
}

describe('property connection routes owner-org enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    configureForeignProperty()
  })

  it('denies a restricted admin listing a foreign property connection', async () => {
    await expectDenied(listConnections, request('/api/v1/properties/property-foreign/connections'), propertyContext)
    expect(listConnectionsForProperty).not.toHaveBeenCalled()
  })

  it('denies a restricted admin reading or mutating a foreign provider connection', async () => {
    await expectDenied(getConnectionRoute, request('/api/v1/properties/property-foreign/connections/ga4'), providerContext)
    await expectDenied(putConnection, request('/api/v1/properties/property-foreign/connections/ga4', 'PUT', { payload: { token: 'x' } }), providerContext)
    await expectDenied(patchConnection, request('/api/v1/properties/property-foreign/connections/ga4', 'PATCH', { status: 'paused' }), providerContext)
    await expectDenied(deleteConnectionRoute, request('/api/v1/properties/property-foreign/connections/ga4', 'DELETE'), providerContext)
    expect(getConnection).not.toHaveBeenCalled()
    expect(setConnectionStatus).not.toHaveBeenCalled()
    expect(deleteConnection).not.toHaveBeenCalled()
    expect(getAdapter).not.toHaveBeenCalled()
  })

  it('denies a restricted admin starting OAuth for a foreign property', async () => {
    await expectDenied(authorizeConnection, request('/api/v1/properties/property-foreign/connections/ga4/authorize'), providerContext)
    expect(getAdapter).not.toHaveBeenCalled()
  })

  it('denies a restricted admin triggering foreign provider pull or backfill', async () => {
    await expectDenied(backfillConnection, request('/api/v1/properties/property-foreign/connections/ga4/backfill', 'POST'), providerContext)
    await expectDenied(pullConnection, request('/api/v1/properties/property-foreign/connections/ga4/pull', 'POST'), providerContext)
    expect(getConnection).not.toHaveBeenCalled()
    expect(dispatchOne).not.toHaveBeenCalled()
  })
})
