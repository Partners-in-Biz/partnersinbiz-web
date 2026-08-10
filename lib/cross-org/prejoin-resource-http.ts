import { createHash, randomBytes } from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import type { PrejoinActorRef, PrejoinResourceInvitation } from './prejoin-resource-adapter'
import type { PartnerResourceType } from './types'

const ISSUABLE_RESOURCE_TYPES = new Set<PartnerResourceType>([
  'project',
  'invoice',
  'quote',
  'document',
  'research',
  'campaign',
  'property',
  'custom',
])

export function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => cleanString(item)).filter(Boolean)))
}

export function normalizeEmail(value: unknown): string {
  return cleanString(value).toLowerCase()
}

export function hashOpaqueValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashEmail(email: string): string {
  return hashOpaqueValue(normalizeEmail(email))
}

export function mintDeliveryToken(): string {
  return randomBytes(32).toString('base64url')
}

export function isIssuablePrejoinResourceType(value: string): value is PartnerResourceType {
  return ISSUABLE_RESOURCE_TYPES.has(value as PartnerResourceType)
}

export function projectPrejoinInvitation(invitation: PrejoinResourceInvitation): Omit<PrejoinResourceInvitation, 'tokenHash'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tokenHash, ...safe } = invitation
  return safe
}

export function actorRefFromCtx(actor: { uid: string; kind?: string }): PrejoinActorRef {
  const kind = actor.kind === 'agent' ? 'agent' : actor.kind === 'system' ? 'system' : 'user'
  return { kind, id: cleanString(actor.uid) }
}

export async function loadActorEmailHash(uid: string | undefined): Promise<string | null> {
  const userId = cleanString(uid)
  if (!userId || userId.startsWith('agent:')) return null
  const snap = await adminDb.collection('users').doc(userId).get()
  if (!snap.exists) return null
  const email = normalizeEmail((snap.data() ?? {}).email)
  if (!email || !email.includes('@')) return null
  return hashEmail(email)
}

export function mapPrejoinServiceError(err: unknown): Response {
  const message = err instanceof Error ? err.message : 'pre-join invitation request failed'
  if (/not found/i.test(message)) return apiError(message, 404)
  if (/supported resource|valid expiry|future|required|not ready|identity|live bilateral|only pending|only expired|canonical grant lifecycle|no longer allowed/i.test(message)) {
    return apiError(message, 400)
  }
  throw err
}
