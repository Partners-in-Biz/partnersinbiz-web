/**
 * @jest-environment node
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {
  BOT_RELAY_INTERVALS,
  BOT_RELAY_RPCS,
  assertNotHostedRoomRpc,
  createDashboardRpc,
  dashboardWsUrl,
  dashboardWsUrlFromEnv,
  deliverClaimed,
  drainToOutbox,
  pollRelayForever,
  relayIntervalsFromContract,
  targetHasDirectPeer,
  type BotProjectionCache,
  type ClaimedRelay,
  type HermesEnvelope,
} from '../../runtime-installers/runtime/bot-relay-courier'
import hermesContract from '../../runtime-installers/runtime/hermes-contract.json'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const SESSION_TOKEN = 'dashboard-session-token'
const API_SERVER_KEY = 'api-server-key-must-never-authenticate-ws'

function acceptKey(key: string) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64')
}

function decodeFrame(buf: Buffer): { opcode: number; payload: Buffer; rest: Buffer } | null {
  if (buf.length < 2) return null
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    len = Number(buf.readBigUInt64BE(2))
    offset = 10
  }
  const maskOffset = offset
  if (masked) offset += 4
  if (buf.length < offset + len) return null
  let payload = buf.subarray(offset, offset + len)
  if (masked) {
    const mask = buf.subarray(maskOffset, maskOffset + 4)
    payload = Buffer.from(payload)
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
  }
  return { opcode, payload, rest: buf.subarray(offset + len) }
}

function encodeText(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
  const header = Buffer.alloc(4)
  header[0] = 0x81
  header[1] = 126
  header.writeUInt16BE(payload.length, 2)
  return Buffer.concat([header, payload])
}

type RpcHandler = (method: string, params: Record<string, unknown>, id: number) => Record<string, unknown> | { error: { code: number; message: string; data?: Record<string, unknown> } }

function startFakeDashboard(handler: RpcHandler, token = SESSION_TOKEN) {
  const rpcs: Array<{ method: string; params: Record<string, unknown> }> = []
  const server = http.createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname !== '/api/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const presented = url.searchParams.get('token') || url.searchParams.get('ticket') || ''
    if (presented !== token || presented === API_SERVER_KEY) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const key = String(req.headers['sec-websocket-key'] || '')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    )
    socket.write(encodeText(`${JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready' } })}\n`))
    let buf = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      while (true) {
        const frame = decodeFrame(buf)
        if (!frame) break
        buf = frame.rest
        if (frame.opcode === 8) {
          socket.end()
          return
        }
        if (frame.opcode !== 1) continue
        for (const line of frame.payload.toString('utf8').split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const reqJson = JSON.parse(trimmed) as { id: number; method: string; params?: Record<string, unknown> }
          rpcs.push({ method: reqJson.method, params: reqJson.params || {} })
          if (reqJson.method.startsWith('groups.')) {
            socket.write(encodeText(`${JSON.stringify({
              jsonrpc: '2.0',
              id: reqJson.id,
              error: { code: -32601, message: 'hosted groups.* is not the PiB room path' },
            })}\n`))
            continue
          }
          const result = handler(reqJson.method, reqJson.params || {}, reqJson.id)
          if ('error' in result) {
            socket.write(encodeText(`${JSON.stringify({ jsonrpc: '2.0', id: reqJson.id, error: result.error })}\n`))
          } else {
            socket.write(encodeText(`${JSON.stringify({ jsonrpc: '2.0', id: reqJson.id, result })}\n`))
          }
        }
      }
    })
  })
  return new Promise<{
    url: string
    port: number
    rpcs: typeof rpcs
    close: () => Promise<void>
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        url: dashboardWsUrl({ host: '127.0.0.1', port, token }),
        port,
        rpcs,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function cache(peers: BotProjectionCache['botProjection']['peers'] = []): BotProjectionCache {
  return {
    profile: 'partners--maya',
    orgId: 'org-1',
    agentId: 'maya',
    botProjection: {
      profileMeta: { title: 'Maya', description: '', avatar: null, section: '', groups: [] },
      rooms: [{
        roomId: 'org-1_growth-desk',
        name: 'Growth desk',
        pictureUrl: null,
        memberHandles: ['@maya-device-a', '@pip-device-b'],
      }],
      peers,
      projectionVersion: 1,
    },
  }
}

function envelope(overrides: Partial<HermesEnvelope> = {}): HermesEnvelope {
  return {
    id: 'aa'.repeat(16),
    created_at: 1_700_000_000,
    from_profile: 'partners--maya',
    from_handle: 'maya',
    target_connection: 'device-b',
    target_profile: 'partners--pip',
    target_handle: 'pip',
    message: 'hello from maya',
    ...overrides,
  }
}

function claimed(overrides: Partial<ClaimedRelay> = {}): ClaimedRelay {
  return {
    envelopeId: 'env-1',
    orgId: 'org-1',
    roomId: 'org-1_growth-desk',
    from: { deviceId: 'device-a', profile: 'partners--maya', agentId: 'maya' },
    to: { deviceId: 'device-b', profile: 'partners--pip', agentId: 'pip' },
    kind: 'room_turn',
    role: 'inbound',
    payload: { text: 'hello from maya' },
    attempt: 1,
    leaseToken: 'lease-1',
    ...overrides,
  }
}

function fakePib(options: {
  outbox?: (body: Record<string, unknown>) => Response
  claim?: () => Response
} = {}) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = []
  const seen = new Map<string, { envelopeId: string; idempotencyKey: string }>()
  const post = async (path: string, body: unknown) => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    posts.push({ path, body: row })
    if (path.endsWith('/relay/outbox')) {
      if (options.outbox) return options.outbox(row)
      const outboxItemId = String(row.outboxItemId || '')
      const existing = seen.get(outboxItemId)
      if (existing) {
        return Response.json({ success: true, data: { ...existing, status: 'queued' } })
      }
      const created = { envelopeId: `pib-${outboxItemId}`, idempotencyKey: `device-a:${outboxItemId}` }
      seen.set(outboxItemId, created)
      return Response.json({ success: true, data: { ...created, status: 'queued' } })
    }
    if (path.endsWith('/relay/claim')) {
      return options.claim ? options.claim() : new Response(null, { status: 204 })
    }
    return Response.json({ success: true, data: { accepted: true } })
  }
  return { posts, post, seen }
}

describe('linked runtime bot relay courier', () => {
  it('uses contract dashboard intervals, session-token WS URL, and never groups.*', () => {
    expect(BOT_RELAY_INTERVALS).toEqual({
      rosterMs: hermesContract.botMode.desktopCourierIntervals.rosterSeconds * 1000,
      drainMs: hermesContract.botMode.desktopCourierIntervals.drainBackstopSeconds * 1000,
      debounceMs: hermesContract.botMode.desktopCourierIntervals.outboxPushDebounceMs,
    })
    expect(BOT_RELAY_INTERVALS.rosterMs).toBe(60_000)
    expect(BOT_RELAY_INTERVALS.drainMs).toBe(30_000)
    expect(BOT_RELAY_INTERVALS.drainMs).not.toBe(4_000)
    expect(relayIntervalsFromContract().drainMs).toBe(30_000)
    const url = dashboardWsUrl({ host: '127.0.0.1', port: 9119, token: SESSION_TOKEN, apiServerKey: API_SERVER_KEY })
    expect(url).toBe(`ws://127.0.0.1:9119/api/ws?token=${SESSION_TOKEN}`)
    expect(url).not.toContain(API_SERVER_KEY)
    expect(url).not.toContain('API_SERVER_KEY')
    expect(dashboardWsUrlFromEnv({
      HERMES_DASHBOARD_SESSION_TOKEN: SESSION_TOKEN,
      API_SERVER_KEY,
    })).toContain(`token=${SESSION_TOKEN}`)
    expect(dashboardWsUrlFromEnv({ API_SERVER_KEY })).toBeNull()
    expect(() => assertNotHostedRoomRpc('groups.create')).toThrow(/hermes-bots-groups/)
    expect(() => assertNotHostedRoomRpc(BOT_RELAY_RPCS.outboxDrain)).not.toThrow()
    const cli = fs.readFileSync(path.join(process.cwd(), 'runtime-installers/runtime/cli.ts'), 'utf8')
    expect(cli).toContain("from './bot-relay-courier'")
    expect(cli).toContain('pollRelayForever')
    expect(cli).toContain("if(require.main===module)")
  })

  it('drains to outbox with idempotency', async () => {
    const item = envelope()
    const dashboard = await startFakeDashboard((method) => {
      if (method === BOT_RELAY_RPCS.outboxDrain) return { envelopes: [item] }
      if (method === BOT_RELAY_RPCS.reply) return { ok: true }
      if (method === BOT_RELAY_RPCS.rosterSync) return { count: 1 }
      return {}
    })
    const pib = fakePib()
    const rpc = await createDashboardRpc({ url: dashboard.url })
    const postedIds = new Set<string>()
    const first = await drainToOutbox({
      envelopes: [item, item],
      deviceId: 'device-a',
      caches: [cache()],
      post: pib.post,
      postedIds,
      reply: (params) => rpc.call(BOT_RELAY_RPCS.reply, params),
    })
    expect(first.posted).toEqual([item.id])
    expect(pib.posts.filter((row) => row.path.endsWith('/relay/outbox'))).toHaveLength(1)
    expect(pib.posts[0].body).toEqual(expect.objectContaining({
      outboxItemId: item.id,
      orgId: 'org-1',
      roomId: 'org-1_growth-desk',
      kind: 'room_turn',
      to: expect.objectContaining({ deviceId: 'device-b', profile: 'partners--pip', agentId: 'pip' }),
    }))
    const second = await drainToOutbox({
      envelopes: [item],
      deviceId: 'device-a',
      caches: [cache()],
      post: pib.post,
      postedIds,
      reply: (params) => rpc.call(BOT_RELAY_RPCS.reply, params),
    })
    expect(second.posted).toEqual([item.id])
    expect(pib.posts.filter((row) => row.path.endsWith('/relay/outbox'))).toHaveLength(1)
    expect(pib.seen.get(item.id)?.idempotencyKey).toBe(`device-a:${item.id}`)
    rpc.close()
    await dashboard.close()
  })

  it('claims and delivers over dashboard session WS, not api_server', async () => {
    const dashboard = await startFakeDashboard((method, params) => {
      if (method === BOT_RELAY_RPCS.deliver) {
        expect(params).toEqual({ profile: 'partners--pip', message: 'hello from maya' })
        return { reply: 'ack from pip' }
      }
      if (method === BOT_RELAY_RPCS.reply) return { ok: true }
      return {}
    })
    expect(dashboard.url).toContain('/api/ws?token=')
    expect(dashboard.url).not.toContain(API_SERVER_KEY)
    const pib = fakePib()
    const rpc = await createDashboardRpc({ url: dashboard.url })
    const outcome = await deliverClaimed({
      claimed: claimed(),
      deviceId: 'device-b',
      post: pib.post,
      deliver: (params) => rpc.call(BOT_RELAY_RPCS.deliver, params) as Promise<{ reply?: string }>,
      replyLocal: (params) => rpc.call(BOT_RELAY_RPCS.reply, params),
    })
    expect(outcome).toEqual({ outcome: 'delivered' })
    expect(dashboard.rpcs.map((row) => row.method)).toEqual([BOT_RELAY_RPCS.deliver])
    expect(pib.posts.map((row) => row.path)).toEqual([
      '/api/v1/linked-computers/device-b/relay/reply',
      '/api/v1/linked-computers/device-b/relay/complete',
    ])
    expect(pib.posts[0].body).toEqual(expect.objectContaining({
      envelopeId: 'env-1',
      leaseToken: 'lease-1',
      payload: expect.objectContaining({ text: 'ack from pip' }),
    }))
    expect(pib.posts[1].body).toEqual(expect.objectContaining({ outcome: 'delivered' }))
    rpc.close()
    await dashboard.close()
  })

  it('propagates typed failure from deliver and not_teammates from outbox', async () => {
    const dashboard = await startFakeDashboard((method) => {
      if (method === BOT_RELAY_RPCS.deliver) {
        return { error: { code: 5096, message: 'target is busy', data: { reason: 'target_busy' } } }
      }
      if (method === BOT_RELAY_RPCS.reply) return { ok: true }
      return {}
    })
    const pib = fakePib()
    const rpc = await createDashboardRpc({ url: dashboard.url })
    const delivered = await deliverClaimed({
      claimed: claimed(),
      deviceId: 'device-b',
      post: pib.post,
      deliver: (params) => rpc.call(BOT_RELAY_RPCS.deliver, params) as Promise<{ reply?: string }>,
      replyLocal: (params) => rpc.call(BOT_RELAY_RPCS.reply, params),
    })
    expect(delivered).toEqual({ outcome: 'failed', reason: 'target_busy' })
    expect(pib.posts.find((row) => row.path.endsWith('/complete'))?.body).toEqual(expect.objectContaining({
      outcome: 'failed',
      failureReason: 'target_busy',
    }))
    expect(pib.posts.find((row) => row.path.endsWith('/reply'))?.body).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ reason: 'target_busy' }),
    }))

    const refused = fakePib({
      outbox: () => Response.json(
        { success: false, error: 'These agents are not in a shared room.', reason: 'not_teammates' },
        { status: 403 },
      ),
    })
    const item = envelope({ id: 'bb'.repeat(16) })
    const outbox = await drainToOutbox({
      envelopes: [item],
      deviceId: 'device-a',
      caches: [cache()],
      post: refused.post,
      reply: (params) => rpc.call(BOT_RELAY_RPCS.reply, params),
    })
    expect(outbox.failed).toEqual([{ id: item.id, reason: 'not_teammates' }])
    expect(dashboard.rpcs.some((row) => (
      row.method === BOT_RELAY_RPCS.reply
      && row.params.id === item.id
      && row.params.reason === 'not_teammates'
    ))).toBe(true)
    rpc.close()
    await dashboard.close()
  })

  it('never relays to a target with a direct peer', async () => {
    const item = envelope()
    const peers = [{ handle: '@pip-device-b', url: 'http://127.0.0.1:18888', keyBindingId: 'bind-1' }]
    expect(targetHasDirectPeer(peers, item)).toBe(true)
    const dashboard = await startFakeDashboard((method) => {
      if (method === BOT_RELAY_RPCS.outboxDrain) return { envelopes: [item] }
      if (method === BOT_RELAY_RPCS.reply) return { ok: true }
      return {}
    })
    const pib = fakePib()
    const rpc = await createDashboardRpc({ url: dashboard.url })
    const drained = await drainToOutbox({
      envelopes: [item],
      deviceId: 'device-a',
      caches: [cache(peers)],
      post: pib.post,
      reply: (params) => rpc.call(BOT_RELAY_RPCS.reply, params),
    })
    expect(drained.skippedPeer).toEqual([item.id])
    expect(drained.posted).toEqual([])
    expect(pib.posts.filter((row) => row.path.endsWith('/relay/outbox'))).toHaveLength(0)
    expect(dashboard.rpcs.filter((row) => row.method === BOT_RELAY_RPCS.reply)).toHaveLength(0)
    rpc.close()
    await dashboard.close()
  })

  it('pollRelayForever uses contract intervals and does not start on import', async () => {
    const waits: number[] = []
    let now = 1_000
    let stopped = false
    const item = envelope({ id: 'cc'.repeat(16) })
    const dashboard = await startFakeDashboard((method) => {
      if (method === BOT_RELAY_RPCS.rosterSync) return { count: 1 }
      if (method === BOT_RELAY_RPCS.outboxDrain) return { envelopes: [item] }
      if (method === BOT_RELAY_RPCS.reply) return { ok: true }
      if (method === BOT_RELAY_RPCS.deliver) return { reply: 'ok' }
      return {}
    })
    const pib = fakePib({
      claim: () => Response.json({ success: true, data: claimed({ to: { deviceId: 'device-a', profile: 'partners--maya', agentId: 'maya' } }) }),
    })
    const rpc = await createDashboardRpc({ url: dashboard.url })
    await pollRelayForever({
      stop: () => stopped,
      nowMs: () => now,
      wait: async (ms) => {
        waits.push(ms)
        now += ms
        if (waits.length >= 1) stopped = true
      },
      getDeviceId: () => 'device-a',
      post: pib.post,
      rpc,
      loadCaches: () => [cache()],
    })
    expect(waits[0]).toBe(30_000)
    expect(waits[0]).not.toBe(4_000)
    expect(dashboard.rpcs.map((row) => row.method)).toEqual(expect.arrayContaining([
      BOT_RELAY_RPCS.rosterSync,
      BOT_RELAY_RPCS.outboxDrain,
      BOT_RELAY_RPCS.deliver,
    ]))
    expect(dashboard.rpcs.some((row) => row.method.startsWith('groups.'))).toBe(false)
    expect(pib.posts.some((row) => row.path.endsWith('/relay/outbox'))).toBe(true)
    rpc.close()
    await dashboard.close()
  })
})
