// lib/customFields/store.ts
import { adminDb } from '@/lib/firebase/admin'
import type { CustomFieldDefinition, CustomFieldResource } from './types'

const COLL = 'customFieldDefinitions'

// Fields that must never come from the request body — the route handler
// (via middleware-authoritative ctx) controls these. Stripping them here
// blocks the cross-tenant-via-body-orgId attack at the source.
const NEVER_FROM_BODY = new Set([
  'id',
  'orgId',
  'createdBy',
  'createdByRef',
  'createdAt',
  'updatedBy',
  'updatedByRef',
  'updatedAt',
  'deleted',
])

const KEY_REGEX = /^[a-z][a-z0-9_]{0,39}$/

export class CustomFieldKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomFieldKeyError'
  }
}

/**
 * Load a single definition by ID, enforcing tenant isolation and soft-delete.
 * Returns null on cross-tenant access, soft-deleted records, or missing docs.
 */
export async function loadDefinition(
  id: string,
  orgId: string,
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: CustomFieldDefinition } | null> {
  if (!id || !orgId) return null
  const ref = adminDb.collection(COLL).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return null
  const data = snap.data() as CustomFieldDefinition
  if (data.orgId !== orgId) return null
  if (data.deleted === true) return null
  return { ref, data: { ...data, id: ref.id } }
}

/**
 * Fetch all active (non-deleted) definitions for a given org + resource,
 * ordered by `order` ascending.
 */
export async function getDefinitionsForResource(
  orgId: string,
  resource: CustomFieldResource,
): Promise<CustomFieldDefinition[]> {
  const snap = await adminDb
    .collection(COLL)
    .where('orgId', '==', orgId)
    .where('resource', '==', resource)
    .where('deleted', '!=', true)
    .orderBy('deleted')
    .orderBy('order', 'asc')
    .get()
  return snap.docs.map(d => ({ ...(d.data() as CustomFieldDefinition), id: d.id }))
}

/**
 * Check whether a key is unique within (orgId, resource).
 * If excludeId is provided, that document is excluded from the check
 * (used when editing an existing definition — its own key doesn't conflict with itself).
 * Returns true if the key is available, false otherwise.
 */
export async function assertKeyUnique(
  orgId: string,
  resource: CustomFieldResource,
  key: string,
  excludeId?: string,
): Promise<boolean> {
  const snap = await adminDb
    .collection(COLL)
    .where('orgId', '==', orgId)
    .where('resource', '==', resource)
    .where('key', '==', key)
    .limit(2)
    .get()
  if (snap.empty) return true
  if (excludeId && snap.size === 1 && snap.docs[0].id === excludeId) return true
  return false
}

/**
 * Strip NEVER_FROM_BODY fields from raw user input, normalize the `key` field
 * (lowercase + trim), and validate it against the key regex.
 * Throws CustomFieldKeyError (including the offending key value) if the regex fails.
 */
export function sanitizeDefinitionForWrite(
  input: Partial<CustomFieldDefinition>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    if (NEVER_FROM_BODY.has(k)) continue
    out[k] = v
  }
  if (typeof out.key === 'string') {
    const lowered = out.key.toLowerCase().trim()
    if (!KEY_REGEX.test(lowered)) {
      throw new CustomFieldKeyError(
        `key "${lowered}" must match ${KEY_REGEX} — must start with a lowercase letter, contain only lowercase letters, digits, or underscores, and be at most 40 characters`,
      )
    }
    out.key = lowered
  }
  return out
}
