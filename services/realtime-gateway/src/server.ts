import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { OAuth2Client } from 'google-auth-library'
import { createClient, type RedisClientType } from 'redis'
import { WebSocketServer, WebSocket } from 'ws'
import { parseGatewayDelivery, parsePubSubPush, REALTIME_PROTOCOL_VERSION, type GatewayDelivery } from './protocol.js'

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10)
const REDIS_URL = process.env.REDIS_URL?.trim() ?? ''
const PUBSUB_PUSH_SERVICE_ACCOUNT = process.env.PUBSUB_PUSH_SERVICE_ACCOUNT?.trim() ?? ''
const PUBSUB_AUDIENCE = process.env.PUBSUB_AUDIENCE?.trim() ?? ''
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? 'https://partnersinbiz.online')
  .split(',').map((origin) => origin.trim()).filter(Boolean))
const MAX_CONNECTIONS_PER_USER = Math.max(1, Math.min(20, Number(process.env.MAX_CONNECTIONS_PER_USER ?? 10)))
const AUTH_TIMEOUT_MS = 5_000
const RECONNECT_BEFORE_CLOUD_RUN_TIMEOUT_MS = 55 * 60_000
const REDIS_CHANNEL = 'pib:realtime:v1:deliveries'
const DEDUPE_KEY_PREFIX = 'pib:realtime:v1:dedupe:'

if (!REDIS_URL) throw new Error('REDIS_URL is required')
if (!Number.isSafeInteger(PORT) || PORT < 1) throw new Error('PORT must be a valid port')

if (!getApps().length) initializeApp()
const firebaseAuth = getAuth()
const oidcClient = new OAuth2Client()
const publisher = createClient({ url: REDIS_URL })
const subscriber = publisher.duplicate()
const socketsByUser = new Map<string, Set<WebSocket>>()
const socketUser = new WeakMap<WebSocket, string>()

function json(response: ServerResponse, status: number, payload: Record<string, unknown>) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  return typeof origin === 'string' && allowedOrigins.has(origin)
}

function closeSocket(socket: WebSocket, code: number, reason: string) {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close(code, reason.slice(0, 123))
  }
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.length <= 120 ? code : 'unknown'
}

function detachSocket(socket: WebSocket) {
  const uid = socketUser.get(socket)
  if (!uid) return
  socketUser.delete(socket)
  const sockets = socketsByUser.get(uid)
  sockets?.delete(socket)
  if (sockets?.size === 0) socketsByUser.delete(uid)
}

function broadcastDelivery(delivery: GatewayDelivery) {
  // This is intentionally opaque. Conversation IDs, org IDs, message bodies,
  // run IDs, and raw Hermes/Firestore fields never leave the gateway.
  const frame = JSON.stringify({
    type: 'invalidate',
    schemaVersion: REALTIME_PROTOCOL_VERSION,
    eventId: delivery.eventId,
  })
  for (const uid of delivery.recipientUserIds) {
    for (const socket of socketsByUser.get(uid) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(frame)
    }
  }
}

async function verifyPubSubRequest(request: IncomingMessage): Promise<boolean> {
  const authorization = request.headers.authorization
  const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!token) return false
  try {
    const ticket = await oidcClient.verifyIdToken({ idToken: token, audience: PUBSUB_AUDIENCE })
    const claims = ticket.getPayload()
    return claims?.email === PUBSUB_PUSH_SERVICE_ACCOUNT && claims.email_verified === true
  } catch {
    return false
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += next.length
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(next)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function handlePubSub(request: IncomingMessage, response: ServerResponse) {
  // Cloud Run assigns its permanent URL only after the first healthy revision.
  // Keep the receiving endpoint fail-closed until the deployment config is
  // updated with that exact OIDC audience.
  if (!PUBSUB_PUSH_SERVICE_ACCOUNT || !PUBSUB_AUDIENCE) {
    return json(response, 503, { error: 'Pub/Sub delivery is not configured' })
  }
  if (!(await verifyPubSubRequest(request))) return json(response, 401, { error: 'unauthorised' })
  let delivery: GatewayDelivery | null = null
  try {
    delivery = parsePubSubPush(await readJsonBody(request))
  } catch {
    return json(response, 400, { error: 'invalid Pub/Sub payload' })
  }
  if (!delivery) return json(response, 400, { error: 'invalid realtime delivery' })

  try {
    const stored = await publisher.set(`${DEDUPE_KEY_PREFIX}${delivery.eventId}`, '1', { NX: true, EX: 3_600 })
    if (stored !== 'OK') return json(response, 204, {})
    await publisher.publish(REDIS_CHANNEL, JSON.stringify(delivery))
    return json(response, 204, {})
  } catch (error) {
    console.error('[realtime-gateway] Redis unavailable during Pub/Sub delivery', error)
    return json(response, 503, { error: 'delivery temporarily unavailable' })
  }
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
  if (request.method === 'GET' && path === '/healthz') {
    return json(response, publisher.isReady && subscriber.isReady ? 200 : 503, {
      ok: publisher.isReady && subscriber.isReady,
    })
  }
  if (request.method === 'POST' && path === '/internal/events/pubsub') {
    await handlePubSub(request, response)
    return
  }
  json(response, 404, { error: 'not found' })
})

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })
server.on('upgrade', (request, socket, head) => {
  const path = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
  if (path !== '/ws' || !originAllowed(request)) {
    socket.write('HTTP/1.1 403 Forbidden\\r\\nConnection: close\\r\\n\\r\\n')
    socket.destroy()
    return
  }
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit('connection', webSocket, request)
  })
})

webSocketServer.on('connection', (socket) => {
  let authenticated = false
  const authenticationDeadline = setTimeout(() => closeSocket(socket, 1008, 'authentication timeout'), AUTH_TIMEOUT_MS)
  const reconnectDeadline = setTimeout(() => closeSocket(socket, 4001, 'reconnect required'), RECONNECT_BEFORE_CLOUD_RUN_TIMEOUT_MS)

  socket.on('message', async (raw) => {
    const payload = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw)
    if (payload.length > 12_000) return closeSocket(socket, 1008, 'invalid frame')
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(payload.toString('utf8')) as Record<string, unknown>
    } catch {
      return closeSocket(socket, 1008, 'invalid frame')
    }
    if (!authenticated) {
      if (frame.type !== 'authenticate' || typeof frame.token !== 'string' || frame.token.length > 12_000) {
        return closeSocket(socket, 1008, 'authentication required')
      }
      try {
        const decoded = await firebaseAuth.verifyIdToken(frame.token, true)
        const uid = decoded.uid?.trim()
        if (!uid) return closeSocket(socket, 1008, 'invalid identity')
        const existing = socketsByUser.get(uid) ?? new Set<WebSocket>()
        if (existing.size >= MAX_CONNECTIONS_PER_USER) return closeSocket(socket, 1013, 'connection limit')
        existing.add(socket)
        socketsByUser.set(uid, existing)
        socketUser.set(socket, uid)
        authenticated = true
        clearTimeout(authenticationDeadline)
        console.info('[realtime-gateway] WebSocket authenticated')
        socket.send(JSON.stringify({ type: 'ready', schemaVersion: REALTIME_PROTOCOL_VERSION }))
      } catch (error) {
        console.warn('[realtime-gateway] WebSocket authentication failed', { code: safeErrorCode(error) })
        closeSocket(socket, 1008, 'invalid authentication')
      }
      return
    }
    if (frame.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', schemaVersion: REALTIME_PROTOCOL_VERSION }))
      return
    }
    // Gateway is never an alternate message/action/Hermes mutation channel.
    closeSocket(socket, 1008, 'read-only gateway')
  })
  socket.on('close', (code, reason) => {
    // Do not log raw client-provided close reasons, user IDs, tokens, or payloads.
    console.info('[realtime-gateway] WebSocket closed', {
      code,
      authenticated,
      reasonProvided: reason.length > 0,
    })
    clearTimeout(authenticationDeadline)
    clearTimeout(reconnectDeadline)
    detachSocket(socket)
  })
  socket.on('error', () => {
    console.warn('[realtime-gateway] WebSocket transport error', { authenticated })
    detachSocket(socket)
  })
})

async function start() {
  await publisher.connect()
  await subscriber.connect()
  await subscriber.subscribe(REDIS_CHANNEL, (raw) => {
    const delivery = (() => {
      try { return parseGatewayDelivery(JSON.parse(raw)) } catch { return null }
    })()
    if (delivery) broadcastDelivery(delivery)
  })
  server.listen(PORT, '0.0.0.0', () => console.log(`[realtime-gateway] listening on ${PORT}`))
}

async function stop() {
  for (const sockets of socketsByUser.values()) {
    for (const socket of sockets) closeSocket(socket, 1012, 'server shutting down')
  }
  await Promise.allSettled([publisher.quit(), subscriber.quit()])
  server.close()
}

process.on('SIGTERM', () => { void stop() })
process.on('SIGINT', () => { void stop() })
void start()
