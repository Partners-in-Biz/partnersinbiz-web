/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { handleRelayClaim } from '@/app/api/v1/linked-computers/[deviceId]/relay/claim/route'
import { handleRelayComplete } from '@/app/api/v1/linked-computers/[deviceId]/relay/complete/route'
import { handleRelayOutbox } from '@/app/api/v1/linked-computers/[deviceId]/relay/outbox/route'
import { handleRelayReply } from '@/app/api/v1/linked-computers/[deviceId]/relay/reply/route'
import { RelayNotTeammatesError } from '@/lib/linked-computers/relay-queue'

const identity = { deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 3 }

const claimed = {
  envelopeId: 'env-a',
  orgId: 'org-1',
  roomId: 'org-1_growth-desk',
  from: { deviceId: 'device-a', profile: 'partners--maya', agentId: 'maya' },
  to: { deviceId: 'device-b', profile: 'partners--pip', agentId: 'pip' },
  kind: 'room_turn',
  role: 'inbound',
  payload: { text: 'hello' },
  attempt: 1,
  leaseToken: 'lease-a',
}

describe('linked computer relay routes', () => {
  it('returns 403 not_teammates when enqueue is refused', async () => {
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/relay/outbox', {
      method: 'POST',
      body: JSON.stringify({
        outboxItemId: 'outbox-1',
        orgId: 'org-1',
        roomId: null,
        kind: 'dm',
        from: { profile: 'partners--maya', agentId: 'maya' },
        to: { deviceId: 'device-b', profile: 'partners--pip', agentId: 'pip' },
        payload: { text: 'hi' },
      }),
    })
    const response = await handleRelayOutbox(req, 'device-a', async () => identity, async () => {
      throw new RelayNotTeammatesError()
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      reason: 'not_teammates',
    })
  })

  it('enqueues through the signed sender device and hides ciphertext', async () => {
    const enqueue = jest.fn(async () => ({
      envelopeId: 'env-a',
      idempotencyKey: 'device-a:outbox-1',
      status: 'queued',
      expiresAtMs: 1,
      encryptedPayload: { ciphertext: 'secret-cipher', iv: 'iv', tag: 'tag' },
    }))
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/relay/outbox', {
      method: 'POST',
      body: JSON.stringify({
        outboxItemId: 'outbox-1',
        orgId: 'org-1',
        roomId: 'org-1_growth-desk',
        kind: 'room_turn',
        from: { profile: 'partners--maya', agentId: 'maya' },
        to: { deviceId: 'device-b', profile: 'partners--pip', agentId: 'pip' },
        payload: { text: 'hello' },
      }),
    })
    const response = await handleRelayOutbox(req, 'device-a', async () => identity, enqueue as never)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual({
      envelopeId: 'env-a',
      idempotencyKey: 'device-a:outbox-1',
      status: 'queued',
      expiresAtMs: 1,
    })
    expect(JSON.stringify(body)).not.toContain('secret-cipher')
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      fromDeviceId: 'device-a',
      outboxItemId: 'outbox-1',
      kind: 'room_turn',
    }))
  })

  it('returns a decrypted claim and 204 when the inbox is empty', async () => {
    const claimReq = new NextRequest('https://app.test/api/v1/linked-computers/device-b/relay/claim', {
      method: 'POST',
      body: '{}',
    })
    const claimedRes = await handleRelayClaim(
      claimReq,
      'device-b',
      async () => ({ ...identity, deviceId: 'device-b' }),
      async () => claimed,
    )
    expect(claimedRes.status).toBe(200)
    await expect(claimedRes.json()).resolves.toEqual({ success: true, data: claimed })

    const empty = await handleRelayClaim(
      new NextRequest('https://app.test/api/v1/linked-computers/device-b/relay/claim', { method: 'POST', body: '{}' }),
      'device-b',
      async () => ({ ...identity, deviceId: 'device-b' }),
      async () => null,
    )
    expect(empty.status).toBe(204)
  })

  it('fails closed when signed identity and path device differ', async () => {
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/relay/claim', {
      method: 'POST',
      body: '{}',
    })
    const response = await handleRelayClaim(req, 'device-a', async () => ({ ...identity, deviceId: 'device-b' }), async () => claimed)
    expect(response.status).toBe(403)
  })

  it('binds reply and complete to the path device, envelope, and lease', async () => {
    const reply = jest.fn(async () => ({ envelopeId: 'env-a', status: 'replied', reply: { status: 'queued' } }))
    const replyReq = new NextRequest('https://app.test/api/v1/linked-computers/device-b/relay/reply', {
      method: 'POST',
      body: JSON.stringify({ envelopeId: 'env-a', leaseToken: 'lease-a', payload: { text: 'ack' } }),
    })
    expect((await handleRelayReply(replyReq, 'device-b', async () => ({ ...identity, deviceId: 'device-b' }), reply as never)).status).toBe(200)
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-b',
      envelopeId: 'env-a',
      leaseToken: 'lease-a',
      payload: { text: 'ack' },
    }))

    const complete = jest.fn(async () => ({ envelopeId: 'env-a', status: 'failed' }))
    const completeReq = new NextRequest('https://app.test/api/v1/linked-computers/device-b/relay/complete', {
      method: 'POST',
      body: JSON.stringify({
        envelopeId: 'env-a',
        leaseToken: 'lease-a',
        outcome: 'failed',
        failureReason: 'bot_relay_target_unavailable',
      }),
    })
    expect((await handleRelayComplete(completeReq, 'device-b', async () => ({ ...identity, deviceId: 'device-b' }), complete as never)).status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-b',
      envelopeId: 'env-a',
      outcome: 'failed',
      failureReason: 'bot_relay_target_unavailable',
    }))
  })
})
