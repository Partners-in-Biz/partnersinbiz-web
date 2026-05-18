// lib/scoring/store.ts
//
// Firestore CRUD for `scoringConfig/{orgId}`.
// Follows the NEVER_FROM_BODY denylist pattern from lib/crm/contacts.ts.

import { adminDb } from '@/lib/firebase/admin'
import type { ScoringConfig, LeadSignalsWeights } from './types'

const COLLECTION = 'scoringConfig'

// Fields that must never come from the request body.
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

export const DEFAULT_LEAD_WEIGHTS: Required<LeadSignalsWeights> = {
  emailOpens: 2,
  emailClicks: 5,
  emailReplies: 15,
  sequenceCompleted: 10,
  recentContact: 10,
  formSubmission: 8,
}

function defaultConfig(orgId: string): ScoringConfig {
  return {
    orgId,
    icp: {},
    leadWeights: { ...DEFAULT_LEAD_WEIGHTS },
    aiEnabled: false,
    aiModel: 'gpt-4o-mini',
    aiCacheHours: 24,
    updatedAt: null,
    createdAt: null,
  }
}

/**
 * Fetch the ScoringConfig doc for an org.
 * Returns null if the doc does not exist.
 */
export async function loadConfig(orgId: string): Promise<ScoringConfig | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection(COLLECTION) as any).doc(orgId).get()
  if (!snap.exists) return null
  return { id: snap.id, ...snap.data() } as ScoringConfig
}

/**
 * Returns the org's config, or a default in-memory config if absent.
 * Does NOT write the default to Firestore.
 */
export async function getOrBootstrapConfig(orgId: string): Promise<ScoringConfig> {
  const config = await loadConfig(orgId)
  return config ?? defaultConfig(orgId)
}

/**
 * Strip NEVER_FROM_BODY fields from an API request body before writing.
 */
export function sanitizeConfigForWrite(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    if (NEVER_FROM_BODY.has(k)) continue
    out[k] = v
  }
  return out
}
