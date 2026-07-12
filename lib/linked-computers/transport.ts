import crypto from 'node:crypto'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
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
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || isIP(host) !== 0) {
    throw new Error('linked computers: invalid runtime hostname or endpoint')
  }
  const allowlist = (process.env.LINKED_RUNTIME_ALLOWED_HOSTS ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  if (allowlist.length === 0) throw new Error('linked computers: runtime hostname allowlist is not configured')
  const allowed = allowlist.some((entry) => entry.startsWith('*.') ? host.endsWith(entry.slice(1)) && host !== entry.slice(2) : host === entry)
  if (!allowed) throw new Error('linked computers: runtime hostname is not allowlisted')
  return clean
}

function ipv4InCidr(address: string, base: string, bits: number): boolean {
  const toInt = (value: string) => value.split('.').reduce((n, part) => (n * 256 + Number(part)) >>> 0, 0)
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (toInt(address) & mask) === (toInt(base) & mask)
}

export function isGloballyRoutableLinkedRuntimeAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const blocked: Array<[string, number]> = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
      ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
      ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ]
    return !blocked.some(([base, bits]) => ipv4InCidr(address, base, bits))
  }
  if (family === 6) {
    const clean = address.toLowerCase()
    if (clean.includes('.')) return false
    if (!/^[23][0-9a-f]{3}:/.test(clean)) return false
    return !clean.startsWith('2001:0:') && !clean.startsWith('2001:2:') && !/^2001:0?2[0-9a-f]:/.test(clean)
      && !clean.startsWith('2001:db8:') && !clean.startsWith('2002:') && !/^3fff:[0-9a-f]{0,3}:/.test(clean)
  }
  return false
}

export async function validateLinkedRuntimeEndpoint(
  endpoint: unknown,
  options: { resolveHost?: (hostname: string) => Promise<string[]> } = {},
): Promise<string> {
  const clean = assertSafeLinkedRuntimeEndpoint(endpoint)
  const hostname = new URL(clean).hostname.toLowerCase()
  const resolveHost = options.resolveHost ?? (async (host: string) => (await lookup(host, { all: true, verbatim: true })).map((row) => row.address))
  const addresses = await resolveHost(hostname)
  if (addresses.length === 0 || addresses.some((address) => !isGloballyRoutableLinkedRuntimeAddress(address))) {
    throw new Error('linked computers: runtime hostname resolved to a non-global address')
  }
  // Node fetch does not expose a portable pinned-lookup hook. The exact/suffix
  // allowlist is therefore a controlled-host assumption; DNS is still checked
  // immediately before token decryption/dispatch and redirects are forbidden.
  return clean
}

export async function updateLinkedRuntimeTransportEndpoint(
  input: { deviceId: string; endpoint: string; credentialVersion: number },
  options: { db?: typeof adminDb; resolveHost?: (hostname: string) => Promise<string[]> } = {},
): Promise<void> {
  const db = options.db ?? adminDb
  const ref = db.collection(LINKED_DEVICE_TRANSPORTS).doc(input.deviceId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('linked computers: transport unavailable')
  const row = snap.data() as unknown as LinkedDeviceRuntimeTransport
  if (row.deviceId !== input.deviceId || row.state === 'revoked' || row.credentialVersion !== input.credentialVersion) {
    throw new Error('linked computers: transport unavailable')
  }
  await ref.update({ endpoint: await validateLinkedRuntimeEndpoint(input.endpoint, options), updatedAt: new Date() })
}

export async function bindLinkedRuntimeTransport(
  input: { deviceId: string; endpoint: string; credentialVersion: number },
  options: { db?: typeof adminDb; resolveHost?: (hostname: string) => Promise<string[]> } = {},
): Promise<{ transportToken: string }> {
  const db = options.db ?? adminDb
  const endpoint = await validateLinkedRuntimeEndpoint(input.endpoint, options)
  const transportToken = crypto.randomBytes(32).toString('base64url')
  await db.runTransaction(async (tx) => {
    const deviceRef = db.collection('linked_devices').doc(input.deviceId)
    const transportRef = db.collection(LINKED_DEVICE_TRANSPORTS).doc(input.deviceId)
    const [deviceSnap, transportSnap] = await Promise.all([tx.get(deviceRef), tx.get(transportRef)])
    const device = deviceSnap.data() ?? {}
    if (!deviceSnap.exists || device.deviceId !== input.deviceId || device.status !== 'active'
      || Number(device.credentialVersion) !== input.credentialVersion) {
      throw new Error('linked computers: active current device required')
    }
    const row = { deviceId: input.deviceId, endpoint, encryptedOutboundToken: encryptLinkedTransportToken(transportToken, input.deviceId), credentialVersion: input.credentialVersion, enabled: true, state: 'active', updatedAt: new Date() }
    if (transportSnap.exists) tx.update(transportRef, row)
    else tx.create(transportRef, { ...row, createdAt: new Date() })
  })
  return { transportToken }
}

export async function getLinkedComputerHermesProfileLink(
  binding: AuthorizedLinkedComputerDispatch,
  orgId: string,
  profile: string,
  options: { db?: typeof adminDb; resolveHost?: (hostname: string) => Promise<string[]> } = {},
): Promise<HermesProfileLink> {
  const db = options.db ?? adminDb
  const snap = await db.collection(LINKED_DEVICE_TRANSPORTS).doc(binding.deviceId).get()
  if (!snap.exists) throw new Error('linked computers: transport unavailable')
  const row = snap.data() as unknown as LinkedDeviceRuntimeTransport
  if (row.deviceId !== binding.deviceId || row.enabled !== true || row.state !== 'active' || row.credentialVersion !== binding.credentialVersion) {
    throw new Error('linked computers: transport unavailable')
  }
  const baseUrl = await validateLinkedRuntimeEndpoint(row.endpoint, options)
  const apiKey = decryptLinkedTransportToken(row.encryptedOutboundToken, binding.deviceId)
  return {
    orgId, profile, baseUrl, apiKey, enabled: true,
    runtimeTargetId: binding.runtimeTargetId, runtimeKind: 'linked-computer', machineLabel: binding.machineLabel,
    capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
    permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
  }
}
