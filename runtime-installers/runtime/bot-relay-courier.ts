import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseManagedProfileName } from './managed-profile'
import hermesContract from './hermes-contract.json'

export const BOT_RELAY_RPCS = {
  rosterSync: 'bot_relay.roster.sync',
  outboxDrain: 'bot_relay.outbox.drain',
  deliver: 'bot_relay.deliver',
  reply: 'bot_relay.reply',
} as const

const HOSTED_ROOM_RPC_PREFIX = 'groups.'
const DEFAULT_DASHBOARD_PORT = 9119
const WS_OPEN = 1
const OUTBOX_ITEM_ID = /^[A-Za-z0-9._:-]{1,128}$/

export const BOT_RELAY_FAILURE_REASONS = [
  ...hermesContract.botMode.failureReasons,
  ...hermesContract.botMode.failureReasonsUsedButNotInEnum,
] as const

export type BotRelayFailureReason = (typeof BOT_RELAY_FAILURE_REASONS)[number] | 'not_teammates'

export type HermesEnvelope = {
  id: string
  created_at: number
  from_profile: string
  from_handle: string
  target_connection: string
  target_profile: string
  target_handle: string
  message: string
}

export type RosterAgent = {
  profile: string
  handle: string
  connection_id: string
  connection_label?: string
  title?: string
  description?: string
}

export type BotProjectionPeer = { handle: string; url: string; keyBindingId: string }

export type BotProjectionCache = {
  profile: string
  orgId: string
  agentId: string
  connectionLabel?: string
  botProjection: {
    profileMeta?: {
      title?: string
      description?: string
      avatar?: string | null
      section?: string
      groups?: string[]
    }
    rooms: Array<{
      roomId: string
      name: string
      pictureUrl: string | null
      memberHandles: string[]
    }>
    peers: BotProjectionPeer[]
    projectionVersion: number
  }
}

export type ClaimedRelay = {
  envelopeId: string
  orgId: string
  roomId: string | null
  from: { deviceId: string; profile: string; agentId: string }
  to: { deviceId: string; profile: string; agentId: string }
  kind: 'dm' | 'room_turn'
  role: 'inbound' | 'reply'
  payload: { text?: string; error?: string; reason?: string; [key: string]: unknown }
  attempt: number
  leaseToken: string
}

export type BotRelayPost = (path: string, body: unknown) => Promise<Response>

export type BotRelayRpc = {
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  close(): void
}

export type CreateWebSocket = (url: string) => Pick<WebSocket, 'readyState' | 'send' | 'close' | 'addEventListener'>

type JsonRpcError = {
  code: number
  message: string
  data?: { reason?: string; [key: string]: unknown }
}

export type BotRelayIntervals = {
  rosterMs: number
  drainMs: number
  debounceMs: number
}

export function relayIntervalsFromContract(
  contract: { botMode?: { desktopCourierIntervals?: { rosterSeconds?: number; drainBackstopSeconds?: number; outboxPushDebounceMs?: number } } } = hermesContract,
): BotRelayIntervals {
  const intervals = contract.botMode?.desktopCourierIntervals ?? {}
  const rosterSeconds = Number(intervals.rosterSeconds)
  const drainSeconds = Number(intervals.drainBackstopSeconds)
  const debounceMs = Number(intervals.outboxPushDebounceMs)
  return {
    rosterMs: Number.isFinite(rosterSeconds) && rosterSeconds > 0 ? rosterSeconds * 1000 : 60_000,
    drainMs: Number.isFinite(drainSeconds) && drainSeconds > 0 ? drainSeconds * 1000 : 30_000,
    debounceMs: Number.isFinite(debounceMs) && debounceMs > 0 ? debounceMs : 250,
  }
}

export const BOT_RELAY_INTERVALS = relayIntervalsFromContract()

export function dashboardWsUrl(input: {
  host?: string
  port?: number
  token?: string
  ticket?: string
  apiServerKey?: string
} = {}): string {
  const host = (input.host || '127.0.0.1').trim() || '127.0.0.1'
  const port = Number.isInteger(input.port) && input.port! > 0 ? input.port! : DEFAULT_DASHBOARD_PORT
  const query = input.ticket
    ? `ticket=${encodeURIComponent(input.ticket)}`
    : `token=${encodeURIComponent(input.token || '')}`
  return `ws://${host}:${port}/api/ws?${query}`
}

export function dashboardWsUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.PIB_HERMES_DASHBOARD_WS?.trim()
  if (explicit) return explicit
  const token = env.HERMES_DASHBOARD_SESSION_TOKEN?.trim()
  const ticket = env.HERMES_DASHBOARD_WS_TICKET?.trim()
  if (!token && !ticket) return null
  const port = Number(env.PIB_HERMES_DASHBOARD_PORT)
  return dashboardWsUrl({
    host: env.PIB_HERMES_DASHBOARD_HOST,
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_DASHBOARD_PORT,
    token,
    ticket,
  })
}

export function assertNotHostedRoomRpc(method: string): void {
  if (method === 'groups' || method.startsWith(HOSTED_ROOM_RPC_PREFIX)) {
    throw new Error('bot relay: rooms persist via profiles.configure / hermes-bots-groups; do not call groups.*')
  }
}

export function isTypedFailureReason(value: unknown): value is BotRelayFailureReason {
  return typeof value === 'string' && (
    (BOT_RELAY_FAILURE_REASONS as readonly string[]).includes(value)
    || value === 'not_teammates'
  )
}

export function mapDeliverFailure(error: JsonRpcError): { reason: BotRelayFailureReason; error: string } {
  const dataReason = error.data && typeof error.data.reason === 'string' ? error.data.reason : ''
  if (isTypedFailureReason(dataReason)) return { reason: dataReason, error: error.message }
  if (error.code === 5093) return { reason: 'delivery_timeout', error: error.message }
  if (error.code === 5096) return { reason: 'target_busy', error: error.message }
  if (error.code === 4092) return { reason: 'missing_config', error: error.message }
  return { reason: 'unknown', error: error.message || 'delivery failed' }
}

export function parseMemberHandle(raw: string, knownAgentIds: string[] = []): {
  handle: string
  agentId: string
  deviceId: string | null
} {
  const trimmed = raw.trim()
  if (trimmed.includes('@') && !trimmed.startsWith('@')) {
    const [handle, deviceId] = trimmed.split('@')
    const clean = handle.replace(/^@/, '')
    return { handle: clean, agentId: clean, deviceId: deviceId || null }
  }
  const body = trimmed.replace(/^@/, '')
  const known = [...knownAgentIds].sort((a, b) => b.length - a.length)
  for (const agentId of known) {
    if (body === agentId) return { handle: agentId, agentId, deviceId: null }
    if (body.startsWith(`${agentId}-`)) {
      return { handle: agentId, agentId, deviceId: body.slice(agentId.length + 1) || null }
    }
  }
  const idx = body.indexOf('-')
  if (idx > 0) {
    const agentId = body.slice(0, idx)
    return { handle: agentId, agentId, deviceId: body.slice(idx + 1) || null }
  }
  return { handle: body, agentId: body, deviceId: null }
}

export function targetHasDirectPeer(
  peers: BotProjectionPeer[] | undefined,
  envelope: Pick<HermesEnvelope, 'target_handle' | 'target_profile' | 'target_connection'>,
): boolean {
  if (!peers?.length) return false
  const handle = envelope.target_handle.replace(/^@/, '').toLowerCase()
  const profile = envelope.target_profile.replace(/^@/, '').toLowerCase()
  const connection = envelope.target_connection.toLowerCase()
  const candidates = new Set([
    handle,
    profile,
    `@${handle}`,
    connection ? `${handle}-${connection}` : '',
    connection ? `@${handle}-${connection}` : '',
    connection ? `${handle}@${connection}` : '',
    connection ? `${profile}-${connection}` : '',
    connection ? `@${profile}-${connection}` : '',
  ].filter(Boolean).map((value) => value.toLowerCase()))
  return peers.some((peer) => {
    const raw = peer.handle.trim()
    if (!raw) return false
    const lower = raw.toLowerCase()
    if (candidates.has(lower) || candidates.has(lower.replace(/^@/, ''))) return true
    const parsed = parseMemberHandle(raw)
    return parsed.agentId.toLowerCase() === handle
      && (!parsed.deviceId || parsed.deviceId.toLowerCase() === connection)
  })
}

export function rosterAgentsFromCache(cache: BotProjectionCache, localDeviceId: string): RosterAgent[] {
  const orgSlug = parseManagedProfileName(cache.profile)?.orgSlugPart || cache.profile
  const known = new Set<string>([cache.agentId])
  for (const room of cache.botProjection.rooms) {
    for (const raw of room.memberHandles) known.add(parseMemberHandle(raw).agentId)
  }
  const seen = new Set<string>()
  const agents: RosterAgent[] = []
  for (const room of cache.botProjection.rooms) {
    for (const raw of room.memberHandles) {
      const parsed = parseMemberHandle(raw, [...known])
      if (!parsed.deviceId || parsed.deviceId === localDeviceId) continue
      if (parsed.agentId === cache.agentId && parsed.deviceId === localDeviceId) continue
      const profile = parsed.agentId.includes('--')
        ? parsed.agentId
        : `${orgSlug}--${parsed.agentId}`
      const key = `${parsed.deviceId}:${profile}`
      if (seen.has(key)) continue
      seen.add(key)
      agents.push({
        profile,
        handle: parsed.handle,
        connection_id: parsed.deviceId,
        ...(cache.connectionLabel ? { connection_label: cache.connectionLabel } : {}),
        ...(cache.botProjection.profileMeta?.title ? { title: cache.botProjection.profileMeta.title } : {}),
      })
    }
  }
  return agents
}

export function matchingRoomId(cache: BotProjectionCache, fromHandle: string, targetHandle: string): string | null {
  const from = parseMemberHandle(fromHandle, [cache.agentId]).agentId
  const target = parseMemberHandle(targetHandle, [cache.agentId]).agentId
  for (const room of cache.botProjection.rooms) {
    const members = room.memberHandles.map((handle) => parseMemberHandle(handle, [cache.agentId]).agentId)
    if (members.includes(from) && members.includes(target)) return room.roomId
  }
  return null
}

function resolveWebSocket(create?: CreateWebSocket): CreateWebSocket {
  if (create) return create
  const Ctor = (globalThis as { WebSocket?: { new (url: string): WebSocket } }).WebSocket
  if (!Ctor) throw new Error('bot relay: global WebSocket is unavailable')
  return (url) => new Ctor(url)
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function createDashboardRpc(input: {
  url: string
  createWebSocket?: CreateWebSocket
  timeoutMs?: number
}): Promise<BotRelayRpc> {
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? 15_000)
  const socket = resolveWebSocket(input.createWebSocket)(input.url)
  let nextId = 1
  let buffer = ''
  const pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void
    reject: (error: Error) => void
  }>()

  const onMessage = (event: { data?: unknown }) => {
    buffer += typeof event.data === 'string' ? event.data : String(event.data ?? '')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed: Record<string, unknown>
      try { parsed = recordOf(JSON.parse(trimmed)) } catch { continue }
      if (parsed.method === 'event' || parsed.id == null) continue
      const id = Number(parsed.id)
      const waiter = pending.get(id)
      if (!waiter) continue
      pending.delete(id)
      const error = parsed.error && typeof parsed.error === 'object' ? parsed.error as JsonRpcError : null
      if (error) {
        const failure = Object.assign(new Error(error.message || 'bot relay rpc failed'), { code: error.code, data: error.data })
        waiter.reject(failure)
        continue
      }
      waiter.resolve(recordOf(parsed.result))
    }
  }

  socket.addEventListener('message', onMessage as never)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bot relay: dashboard websocket timed out')), timeoutMs)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    socket.addEventListener('open', () => finish())
    socket.addEventListener('error', () => finish(new Error('bot relay: dashboard websocket failed')))
    if (socket.readyState === WS_OPEN) finish()
  })

  return {
    async call(method, params = {}) {
      assertNotHostedRoomRpc(method)
      if (socket.readyState !== WS_OPEN) throw new Error('bot relay: dashboard websocket is closed')
      const id = nextId++
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
      const result = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`bot relay: ${method} timed out`))
        }, method === BOT_RELAY_RPCS.deliver ? Math.max(timeoutMs, 60_000) : timeoutMs)
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value) },
          reject: (error) => { clearTimeout(timer); reject(error) },
        })
      })
      socket.send(payload)
      return result
    },
    close() {
      for (const waiter of pending.values()) waiter.reject(new Error('bot relay: dashboard websocket closed'))
      pending.clear()
      socket.close()
    },
  }
}

export function loadProjectionCaches(stateRoot: string): BotProjectionCache[] {
  const dir = path.join(stateRoot, 'bot-projection')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as BotProjectionCache
        if (!raw?.profile || !raw.orgId || !raw.botProjection) return []
        return [raw]
      } catch {
        return []
      }
    })
}

function cacheForProfile(caches: BotProjectionCache[], profile: string): BotProjectionCache | undefined {
  return caches.find((cache) => cache.profile === profile)
}

function peersForTarget(caches: BotProjectionCache[], envelope: HermesEnvelope): BotProjectionPeer[] {
  const fromCache = cacheForProfile(caches, envelope.from_profile)
  if (fromCache) return fromCache.botProjection.peers
  return caches.flatMap((cache) => cache.botProjection.peers)
}

export async function drainToOutbox(input: {
  envelopes: HermesEnvelope[]
  deviceId: string
  caches: BotProjectionCache[]
  post: BotRelayPost
  reply: (params: { id: string; reply?: string; error?: string; reason?: string }) => Promise<unknown>
  postedIds?: Set<string>
}): Promise<{ posted: string[]; skippedPeer: string[]; failed: Array<{ id: string; reason: string }> }> {
  const posted = input.postedIds ?? new Set<string>()
  const result = { posted: [] as string[], skippedPeer: [] as string[], failed: [] as Array<{ id: string; reason: string }> }
  for (const envelope of input.envelopes) {
    if (!envelope?.id || !OUTBOX_ITEM_ID.test(envelope.id)) continue
    if (targetHasDirectPeer(peersForTarget(input.caches, envelope), envelope)) {
      result.skippedPeer.push(envelope.id)
      continue
    }
    if (posted.has(envelope.id)) {
      if (!result.posted.includes(envelope.id)) result.posted.push(envelope.id)
      continue
    }
    const cache = cacheForProfile(input.caches, envelope.from_profile) ?? input.caches[0]
    const fromParsed = parseManagedProfileName(envelope.from_profile)
    const toParsed = parseManagedProfileName(envelope.target_profile)
    const roomId = cache ? matchingRoomId(cache, envelope.from_handle, envelope.target_handle) : null
    const body = {
      outboxItemId: envelope.id,
      orgId: cache?.orgId || '',
      roomId,
      kind: roomId ? 'room_turn' : 'dm',
      from: {
        profile: envelope.from_profile,
        agentId: fromParsed?.agentId || cache?.agentId || envelope.from_handle,
      },
      to: {
        deviceId: envelope.target_connection,
        profile: envelope.target_profile,
        agentId: toParsed?.agentId || envelope.target_handle,
      },
      payload: { text: envelope.message, hermesEnvelopeId: envelope.id },
    }
    try {
      const response = await input.post(`/api/v1/linked-computers/${input.deviceId}/relay/outbox`, body)
      if (response.status === 403) {
        const payload = recordOf(await response.json().catch(() => ({})))
        const reason = payload.reason === 'not_teammates' ? 'not_teammates' : 'unknown'
        await input.reply({ id: envelope.id, error: String(payload.error || 'These agents are not in a shared room.'), reason })
        result.failed.push({ id: envelope.id, reason })
        continue
      }
      if (!response.ok) throw new Error(`PiB relay outbox rejected (${response.status})`)
      posted.add(envelope.id)
      result.posted.push(envelope.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'outbox failed'
      await input.reply({ id: envelope.id, error: message, reason: 'unknown' }).catch(() => undefined)
      result.failed.push({ id: envelope.id, reason: 'unknown' })
    }
  }
  return result
}

export async function deliverClaimed(input: {
  claimed: ClaimedRelay
  deviceId: string
  post: BotRelayPost
  deliver: (params: { profile: string; message: string }) => Promise<{ reply?: string }>
  replyLocal: (params: { id: string; reply?: string; error?: string; reason?: string }) => Promise<unknown>
  hermesEnvelopeId?: string
}): Promise<{ outcome: 'delivered' | 'failed' | 'replied'; reason?: string }> {
  const pathPrefix = `/api/v1/linked-computers/${input.deviceId}/relay`
  if (input.claimed.role === 'reply') {
    const hermesId = input.hermesEnvelopeId
      || (typeof input.claimed.payload.hermesEnvelopeId === 'string' ? input.claimed.payload.hermesEnvelopeId : '')
      || input.claimed.envelopeId
    const reason = typeof input.claimed.payload.reason === 'string' ? input.claimed.payload.reason : undefined
    await input.replyLocal({
      id: hermesId,
      ...(typeof input.claimed.payload.text === 'string' ? { reply: input.claimed.payload.text } : {}),
      ...(typeof input.claimed.payload.error === 'string' ? { error: input.claimed.payload.error } : {}),
      ...(reason ? { reason } : {}),
    })
    return { outcome: 'replied' }
  }

  const message = typeof input.claimed.payload.text === 'string' ? input.claimed.payload.text : ''
  try {
    const delivered = await input.deliver({ profile: input.claimed.to.profile, message })
    await input.post(`${pathPrefix}/reply`, {
      envelopeId: input.claimed.envelopeId,
      leaseToken: input.claimed.leaseToken,
      payload: { text: delivered.reply || '', hermesEnvelopeId: input.hermesEnvelopeId },
    })
    await input.post(`${pathPrefix}/complete`, {
      envelopeId: input.claimed.envelopeId,
      leaseToken: input.claimed.leaseToken,
      outcome: 'delivered',
    })
    return { outcome: 'delivered' }
  } catch (error) {
    const mapped = mapDeliverFailure({
      code: Number((error as { code?: number }).code || 5092),
      message: error instanceof Error ? error.message : 'delivery failed',
      data: (error as { data?: JsonRpcError['data'] }).data,
    })
    await input.post(`${pathPrefix}/reply`, {
      envelopeId: input.claimed.envelopeId,
      leaseToken: input.claimed.leaseToken,
      payload: { error: mapped.error, reason: mapped.reason },
    }).catch(() => undefined)
    await input.post(`${pathPrefix}/complete`, {
      envelopeId: input.claimed.envelopeId,
      leaseToken: input.claimed.leaseToken,
      outcome: 'failed',
      failureReason: mapped.reason,
    }).catch(() => undefined)
    return { outcome: 'failed', reason: mapped.reason }
  }
}

export async function syncRemoteRoster(input: {
  rpc: BotRelayRpc
  caches: BotProjectionCache[]
  localDeviceId: string
}): Promise<number> {
  const agents = input.caches.flatMap((cache) => rosterAgentsFromCache(cache, input.localDeviceId))
  const result = await input.rpc.call(BOT_RELAY_RPCS.rosterSync, { agents })
  return Number(result.count || agents.length)
}

export async function drainRemoteOutbox(input: {
  rpc: BotRelayRpc
  deviceId: string
  caches: BotProjectionCache[]
  post: BotRelayPost
  postedIds?: Set<string>
}): Promise<Awaited<ReturnType<typeof drainToOutbox>>> {
  const result = await input.rpc.call(BOT_RELAY_RPCS.outboxDrain, {})
  const envelopes = Array.isArray(result.envelopes) ? result.envelopes as HermesEnvelope[] : []
  return drainToOutbox({
    envelopes,
    deviceId: input.deviceId,
    caches: input.caches,
    post: input.post,
    postedIds: input.postedIds,
    reply: (params) => input.rpc.call(BOT_RELAY_RPCS.reply, params),
  })
}

async function readJsonData(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  if (!response.ok) throw new Error(`PiB request rejected (${response.status})`)
  const body = recordOf(await response.json())
  return body.data ?? null
}

export type BotRelayCourierOptions = {
  stop: () => boolean
  wait?: (ms: number) => Promise<void>
  nowMs?: () => number
  getDeviceId?: () => Promise<string> | string
  post?: BotRelayPost
  rpc?: BotRelayRpc
  connect?: () => Promise<BotRelayRpc>
  loadCaches?: () => BotProjectionCache[] | Promise<BotProjectionCache[]>
  stateRoot?: string
  env?: NodeJS.ProcessEnv
  intervals?: Partial<BotRelayIntervals>
  postedIds?: Set<string>
}

async function resolveRpc(options: BotRelayCourierOptions): Promise<BotRelayRpc | null> {
  if (options.rpc) return options.rpc
  if (options.connect) return options.connect()
  const env = options.env ?? process.env
  const url = dashboardWsUrlFromEnv(env)
  if (!url) return null
  return createDashboardRpc({ url })
}

/**
 * Service poller. Safe to import — this module never starts loops on load.
 * `cli.ts` only calls this from `service()`, which itself is gated by `require.main`.
 */
export async function pollRelayForever(options: BotRelayCourierOptions): Promise<void> {
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const nowMs = options.nowMs ?? Date.now
  const intervals = { ...BOT_RELAY_INTERVALS, ...options.intervals }
  const postedIds = options.postedIds ?? new Set<string>()
  let rosterDue = 0
  let drainDue = 0
  let rpc: BotRelayRpc | null = options.rpc ?? null

  const deviceIdOf = async () => {
    if (!options.getDeviceId) return ''
    return options.getDeviceId()
  }

  while (!options.stop()) {
    const now = nowMs()
    try {
      if (!rpc) rpc = await resolveRpc(options).catch(() => null)
      const deviceId = await deviceIdOf()
      const caches = options.loadCaches
        ? await options.loadCaches()
        : loadProjectionCaches(options.stateRoot || options.env?.PIB_RUNTIME_STATE_DIR || path.join(os.homedir(), '.partnersinbiz'))
      if (rpc && deviceId && now >= rosterDue) {
        await syncRemoteRoster({ rpc, caches, localDeviceId: deviceId }).catch(() => undefined)
        rosterDue = now + intervals.rosterMs
      }
      if (rpc && deviceId && options.post && now >= drainDue) {
        await drainRemoteOutbox({ rpc, deviceId, caches, post: options.post, postedIds }).catch(() => undefined)
        const claimed = await options.post(`/api/v1/linked-computers/${deviceId}/relay/claim`, {})
          .then(readJsonData)
          .catch(() => null) as ClaimedRelay | null
        if (claimed && claimed.envelopeId) {
          await deliverClaimed({
            claimed,
            deviceId,
            post: options.post,
            deliver: (params) => rpc!.call(BOT_RELAY_RPCS.deliver, params) as Promise<{ reply?: string }>,
            replyLocal: (params) => rpc!.call(BOT_RELAY_RPCS.reply, params),
            hermesEnvelopeId: typeof claimed.payload.hermesEnvelopeId === 'string'
              ? claimed.payload.hermesEnvelopeId
              : undefined,
          }).catch(() => undefined)
        }
        drainDue = now + intervals.drainMs
      }
    } catch {
      // Keep the service poller alive; the next interval retries.
    }
    if (options.stop()) return
    const next = Math.max(50, Math.min(
      rosterDue > 0 ? rosterDue - nowMs() : intervals.rosterMs,
      drainDue > 0 ? drainDue - nowMs() : intervals.drainMs,
    ))
    await wait(next)
  }
}
