import { adminDb } from '@/lib/firebase/admin'

export type RuntimeReleaseChannel = 'internal' | 'stable'

export interface HermesChannelPin {
  targetVersion: string
  minVersion: string
  targetTag: string
}

export interface RuntimeChannelConfig {
  hermes: HermesChannelPin
  runtimeMinVersion: string
}

export interface RuntimeChannelsDocument {
  internal: RuntimeChannelConfig
  stable: RuntimeChannelConfig
}

export const RUNTIME_CHANNEL_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export const RUNTIME_CHANNEL_TAG = /^v\d{4}\.\d{1,2}\.\d{1,2}$/

export const DEFAULT_RUNTIME_CHANNELS: RuntimeChannelsDocument = {
  internal: {
    hermes: { targetVersion: '0.21.0', minVersion: '0.20.6', targetTag: 'v2026.8.31' },
    runtimeMinVersion: '1.2.0',
  },
  stable: {
    hermes: { targetVersion: '0.20.6', minVersion: '0.20.4', targetTag: 'v2026.8.27' },
    runtimeMinVersion: '1.1.30',
  },
}

export const LINKED_RUNTIME_CHANNELS_COLLECTION = 'platform_config'
export const LINKED_RUNTIME_CHANNELS_DOC = 'linked_runtime_channels'
const CACHE_TTL_MS = 60_000

export interface RuntimeChannelDocSnapshot {
  exists: boolean
  data(): Record<string, unknown> | undefined
}

export interface RuntimeChannelConfigStore {
  get(): Promise<RuntimeChannelDocSnapshot>
  set?(value: RuntimeChannelsDocument): Promise<void>
}

interface CacheEntry {
  expiresAt: number
  value: RuntimeChannelsDocument
}

let cache: CacheEntry | null = null

function defaultStore(): RuntimeChannelConfigStore {
  return {
    async get() {
      const snap = await adminDb.collection(LINKED_RUNTIME_CHANNELS_COLLECTION).doc(LINKED_RUNTIME_CHANNELS_DOC).get()
      return { exists: snap.exists, data: () => snap.data() as Record<string, unknown> | undefined }
    },
    async set(value) {
      await adminDb.collection(LINKED_RUNTIME_CHANNELS_COLLECTION).doc(LINKED_RUNTIME_CHANNELS_DOC).set(value)
    },
  }
}

export function resetRuntimeChannelConfigCache(): void {
  cache = null
}

export function isRuntimeChannelSemver(value: string): boolean {
  return RUNTIME_CHANNEL_SEMVER.test(value)
}

export function isRuntimeChannelTag(value: string): boolean {
  return RUNTIME_CHANNEL_TAG.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function parseHermesChannelPin(value: unknown): HermesChannelPin | null {
  const row = asRecord(value)
  if (!row) return null
  const targetVersion = typeof row.targetVersion === 'string' ? row.targetVersion.trim() : ''
  const minVersion = typeof row.minVersion === 'string' ? row.minVersion.trim() : ''
  const targetTag = typeof row.targetTag === 'string' ? row.targetTag.trim() : ''
  if (!isRuntimeChannelSemver(targetVersion) || !isRuntimeChannelSemver(minVersion) || !isRuntimeChannelTag(targetTag)) {
    return null
  }
  return { targetVersion, minVersion, targetTag }
}

export function parseRuntimeChannelConfig(value: unknown): RuntimeChannelConfig | null {
  const row = asRecord(value)
  if (!row) return null
  const hermes = parseHermesChannelPin(row.hermes)
  const runtimeMinVersion = typeof row.runtimeMinVersion === 'string' ? row.runtimeMinVersion.trim() : ''
  if (!hermes || !isRuntimeChannelSemver(runtimeMinVersion)) return null
  return { hermes, runtimeMinVersion }
}

export function parseRuntimeChannelsDocument(value: unknown): RuntimeChannelsDocument | null {
  const row = asRecord(value)
  if (!row) return null
  const internal = parseRuntimeChannelConfig(row.internal)
  const stable = parseRuntimeChannelConfig(row.stable)
  if (!internal || !stable) return null
  return { internal, stable }
}

function resolveChannelsDocument(value: unknown): RuntimeChannelsDocument {
  const parsed = parseRuntimeChannelsDocument(value)
  if (parsed) return parsed
  const row = asRecord(value)
  if (!row) return DEFAULT_RUNTIME_CHANNELS
  return {
    internal: parseRuntimeChannelConfig(row.internal) ?? DEFAULT_RUNTIME_CHANNELS.internal,
    stable: parseRuntimeChannelConfig(row.stable) ?? DEFAULT_RUNTIME_CHANNELS.stable,
  }
}

async function loadChannelsDocument(
  options: { store?: RuntimeChannelConfigStore; nowMs?: () => number } = {},
): Promise<RuntimeChannelsDocument> {
  const now = options.nowMs?.() ?? Date.now()
  if (cache && cache.expiresAt > now) return cache.value
  const store = options.store ?? defaultStore()
  let value = DEFAULT_RUNTIME_CHANNELS
  try {
    const snap = await store.get()
    if (snap.exists) value = resolveChannelsDocument(snap.data())
  } catch {
    value = DEFAULT_RUNTIME_CHANNELS
  }
  cache = { expiresAt: now + CACHE_TTL_MS, value }
  return value
}

export async function getRuntimeChannelConfig(
  channel: RuntimeReleaseChannel,
  options: { store?: RuntimeChannelConfigStore; nowMs?: () => number } = {},
): Promise<RuntimeChannelConfig> {
  const doc = await loadChannelsDocument(options)
  return doc[channel]
}

export async function getRuntimeChannelsDocument(
  options: { store?: RuntimeChannelConfigStore; nowMs?: () => number } = {},
): Promise<RuntimeChannelsDocument> {
  return loadChannelsDocument(options)
}

export async function writeRuntimeChannelsDocument(
  value: RuntimeChannelsDocument,
  options: { store?: RuntimeChannelConfigStore } = {},
): Promise<RuntimeChannelsDocument> {
  const parsed = parseRuntimeChannelsDocument(value)
  if (!parsed) throw new Error('linked computers: invalid runtime channel configuration')
  const store = options.store ?? defaultStore()
  if (!store.set) throw new Error('linked computers: runtime channel store is read-only')
  await store.set(parsed)
  resetRuntimeChannelConfigCache()
  return parsed
}
