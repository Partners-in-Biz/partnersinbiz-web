import crypto from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { validateHermesBaseUrl } from '@/lib/hermes/server'
import type { HermesProfileLink } from '@/lib/hermes/types'
import type { AuthorizedLinkedComputerDispatch } from './runtime-targets'

export const LINKED_DEVICE_TRANSPORTS = 'linked_device_runtime_transports'
const CONTEXT = 'linked-computer-runtime-transport'

export interface EncryptedLinkedTransportToken { ciphertext: string; iv: string; tag: string }
export interface LinkedDeviceRuntimeTransport {
  deviceId: string
  endpoint: string
  encryptedOutboundToken: EncryptedLinkedTransportToken
  credentialVersion: number
  enabled: boolean
  state: 'active' | 'paused' | 'revoked'
  updatedAt: unknown
}

function masterKey(): Buffer {
  const value = process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()
  if (!value) throw new Error('Missing env var: SOCIAL_TOKEN_MASTER_KEY')
  return value.length === 64 && /^[0-9a-f]+$/i.test(value) ? Buffer.from(value, 'hex') : crypto.createHash('sha256').update(value).digest()
}

function key(deviceId: string): Buffer {
  return crypto.createHmac('sha256', masterKey()).update(`${CONTEXT}:${deviceId}`).digest()
}

export function encryptLinkedTransportToken(token: string, deviceId: string): EncryptedLinkedTransportToken {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(deviceId), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function decryptLinkedTransportToken(value: EncryptedLinkedTransportToken, deviceId: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(deviceId), Buffer.from(value.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return decipher.update(Buffer.from(value.ciphertext, 'base64')) + decipher.final('utf8')
}

export function assertSafeLinkedRuntimeEndpoint(endpoint: unknown): string {
  const clean = typeof endpoint === 'string' ? endpoint.trim().replace(/\/+$/, '') : ''
  if (!clean || clean.length > 2048 || validateHermesBaseUrl(clean)) throw new Error('linked computers: invalid runtime endpoint')
  const url = new URL(clean)
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number)
  const privateV4 = ipv4 && (ipv4[0] === 10 || ipv4[0] === 127 || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 192 && ipv4[1] === 168))
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || host === 'localhost' || host === '::1' || /^f[cd][0-9a-f]:/.test(host) || privateV4) {
    throw new Error('linked computers: invalid runtime endpoint')
  }
  return clean
}

export async function updateLinkedRuntimeTransportEndpoint(
  input: { deviceId: string; endpoint: string; credentialVersion: number },
  options: { db?: typeof adminDb } = {},
): Promise<void> {
  const db = options.db ?? adminDb
  const ref = db.collection(LINKED_DEVICE_TRANSPORTS).doc(input.deviceId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('linked computers: transport unavailable')
  const row = snap.data() as unknown as LinkedDeviceRuntimeTransport
  if (row.deviceId !== input.deviceId || row.state === 'revoked' || row.credentialVersion !== input.credentialVersion) {
    throw new Error('linked computers: transport unavailable')
  }
  await ref.update({ endpoint: assertSafeLinkedRuntimeEndpoint(input.endpoint), updatedAt: new Date() })
}

export async function getLinkedComputerHermesProfileLink(
  binding: AuthorizedLinkedComputerDispatch,
  orgId: string,
  profile: string,
  options: { db?: typeof adminDb } = {},
): Promise<HermesProfileLink> {
  const db = options.db ?? adminDb
  const snap = await db.collection(LINKED_DEVICE_TRANSPORTS).doc(binding.deviceId).get()
  if (!snap.exists) throw new Error('linked computers: transport unavailable')
  const row = snap.data() as unknown as LinkedDeviceRuntimeTransport
  if (row.deviceId !== binding.deviceId || row.enabled !== true || row.state !== 'active' || row.credentialVersion !== binding.credentialVersion) {
    throw new Error('linked computers: transport unavailable')
  }
  const baseUrl = assertSafeLinkedRuntimeEndpoint(row.endpoint)
  const apiKey = decryptLinkedTransportToken(row.encryptedOutboundToken, binding.deviceId)
  return {
    orgId, profile, baseUrl, apiKey, enabled: true,
    runtimeTargetId: binding.runtimeTargetId, runtimeKind: 'linked-computer', machineLabel: binding.machineLabel,
    capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
    permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
  }
}
