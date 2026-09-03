import { NextRequest } from 'next/server'
import { handlePairingCreate } from '@/app/api/v1/linked-computers/pairing/route'
import { handlePairingExchange } from '@/app/api/v1/linked-computers/pairing/exchange/route'

describe('linked computer pairing HTTP redaction', () => {
  const logSpies: jest.SpyInstance[] = []

  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      logSpies.push(jest.spyOn(console, method).mockImplementation(() => undefined))
    }
  })

  afterEach(() => {
    logSpies.splice(0).forEach((spy) => spy.mockRestore())
  })

  it('returns only the one-time challenge fields with no-store', async () => {
    const response = await handlePairingCreate({ uid: 'user-a' }, async () => ({
      challengeId: 'challenge-a', secret: 'pairing-secret', expiresAt: 'expiry',
    }))
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const json = await response.json()
    expect(Object.keys(json)).toEqual(['success', 'data'])
    expect(Object.keys(json.data).sort()).toEqual(['challengeId', 'expiresAt', 'secret'])
    expect(logSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })

  it('passes validated VPS and organisation ownership choices into challenge creation', async () => {
    const create = jest.fn(async () => ({
      challengeId: 'challenge-vps', secret: 'pairing-secret', expiresAt: 'expiry',
    }))
    const response = await handlePairingCreate({ uid: 'admin-a' }, {
      deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a',
    }, create)
    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledWith({
      actorUserId: 'admin-a', deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a',
    })
  })

  it('passes orgId and agentIds into challenge creation', async () => {
    const create = jest.fn(async () => ({
      challengeId: 'challenge-agents', secret: 'pairing-secret', expiresAt: 'expiry',
    }))
    const response = await handlePairingCreate({ uid: 'user-a' }, {
      deviceKind: 'computer', ownerType: 'user', orgId: 'org-a', agentIds: ['pip', 'maya'],
    }, create)
    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledWith({
      actorUserId: 'user-a', deviceKind: 'computer', ownerType: 'user', orgId: 'org-a', agentIds: ['pip', 'maya'],
    })
  })

  it('passes an explicit legacy location adoption choice into challenge creation', async () => {
    const create = jest.fn(async () => ({
      challengeId: 'challenge-adopt', secret: 'pairing-secret', expiresAt: 'expiry',
      adoption: { sourceLocationId: 'partners-vps', state: 'awaiting_runtime_proof' as const },
    }))
    const response = await handlePairingCreate({ uid: 'admin-a' }, {
      deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a', adoptLocationId: 'partners-vps',
    }, create)
    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledWith({
      actorUserId: 'admin-a', deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a',
      adoptLocationId: 'partners-vps',
    })
    expect(await response.json()).toMatchObject({
      data: { adoption: { sourceLocationId: 'partners-vps', state: 'awaiting_runtime_proof' } },
    })
  })

  it('rejects a malformed legacy location identifier before challenge creation', async () => {
    const create = jest.fn()
    const response = await handlePairingCreate({ uid: 'admin-a' }, {
      deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a', adoptLocationId: '../partners-vps',
    }, create)

    expect(response.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ success: false, error: 'Invalid project location' })
  })

  it('returns a generic no-store challenge creation error without logging', async () => {
    const response = await handlePairingCreate({ uid: 'user-a' }, async () => {
      throw new Error('database included pairing-secret')
    })
    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('pairing-secret')
    expect(logSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })

  it('returns only device credential fields once and never logs request secrets or proof', async () => {
    const payload = { challengeId: 'challenge-a', secret: 'pairing-secret', proof: 'machine-proof' }
    const request = new NextRequest('https://example.test/api/v1/linked-computers/pairing/exchange', {
      method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
    })
    const response = await handlePairingExchange(request, async () => ({
      deviceId: 'device-a', credential: 'device-credential', credentialVersion: 1, ownerUserId: 'user-a',
    }))
    expect(response.headers.get('cache-control')).toBe('no-store')
    const json = await response.json()
    expect(Object.keys(json.data).sort()).toEqual(['credential', 'credentialVersion', 'deviceId', 'ownerUserId'])
    expect(JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls))).not.toMatch(/pairing-secret|machine-proof|device-credential|transport-token/)
  })

  it('uses a safe generic no-store error response without echoing secret or proof', async () => {
    const request = new NextRequest('https://example.test/api/v1/linked-computers/pairing/exchange', {
      method: 'POST', body: JSON.stringify({ secret: 'pairing-secret', proof: 'machine-proof' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await handlePairingExchange(request, async () => {
      throw new Error('linked computers: pairing exchange denied')
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.text()
    expect(body).not.toMatch(/pairing-secret|machine-proof/)
    expect(logSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })
})
