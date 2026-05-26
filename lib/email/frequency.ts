// lib/email/frequency.ts
//
// Per-contact frequency capping. Independent of preferences — a contact that
// has opted-in to everything can still be capped to "max N emails per rolling
// 7d / 24h". Used by every send pipeline AFTER the preferences gate passes.
//
// Storage: `organizations/{orgId}.settings.frequencyCap` (matches the rest of
// the org-settings pattern in lib/ai/voice-presets.ts).
//
// Counting: per-call lookup of the contact's `emails` docs in the last 24h /
// 7d, filtered by `status in ['sent', 'delivered', 'opened', 'clicked']`
// (anything that actually went out). Topics in `exemptTopics` aren't counted.
//
// For moderate volume this is fine. If volume grows past ~50k contacts/day
// per org, replace with FieldValue.increment counters on a per-contact
// `frequency_counters/{contactId}` doc.

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export interface FrequencyCapConfig {
  enabled: boolean
  maxPer7Days: number
  maxPer24Hours: number
  exemptTopics: string[]
}

export const DEFAULT_FREQUENCY_CAP: FrequencyCapConfig = {
  enabled: false,
  maxPer7Days: 7,
  maxPer24Hours: 3,
  exemptTopics: ['transactional'],
}

const SETTINGS_FIELD = 'settings.frequencyCap'

export async function getOrgFrequencyCap(orgId: string): Promise<FrequencyCapConfig> {
  if (!orgId) throw new Error('orgId is required')
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  if (!snap.exists) return { ...DEFAULT_FREQUENCY_CAP }
  const data = snap.data() ?? {}
  const raw = (data.settings?.frequencyCap ?? null) as Partial<FrequencyCapConfig> | null
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FREQUENCY_CAP }

  return {
    enabled: raw.enabled === true,
    maxPer7Days:
      typeof raw.maxPer7Days === 'number' && raw.maxPer7Days >= 0
        ? Math.floor(raw.maxPer7Days)
        : DEFAULT_FREQUENCY_CAP.maxPer7Days,
    maxPer24Hours:
      typeof raw.maxPer24Hours === 'number' && raw.maxPer24Hours >= 0
        ? Math.floor(raw.maxPer24Hours)
        : DEFAULT_FREQUENCY_CAP.maxPer24Hours,
    exemptTopics: Array.isArray(raw.exemptTopics)
      ? raw.exemptTopics.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [...DEFAULT_FREQUENCY_CAP.exemptTopics],
  }
}

export async function setOrgFrequencyCap(
  orgId: string,
  patch: Partial<FrequencyCapConfig>,
): Promise<FrequencyCapConfig> {
  if (!orgId) throw new Error('orgId is required')
  const current = await getOrgFrequencyCap(orgId)
  const next: FrequencyCapConfig = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    maxPer7Days:
      typeof patch.maxPer7Days === 'number' && patch.maxPer7Days >= 0
        ? Math.floor(patch.maxPer7Days)
        : current.maxPer7Days,
    maxPer24Hours:
      typeof patch.maxPer24Hours === 'number' && patch.maxPer24Hours >= 0
        ? Math.floor(patch.maxPer24Hours)
        : current.maxPer24Hours,
    exemptTopics: Array.isArray(patch.exemptTopics)
      ? patch.exemptTopics.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : current.exemptTopics,
  }

  await adminDb.collection('organizations').doc(orgId).set(
    {
      settings: { frequencyCap: next },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  return next
}

export interface FrequencyCheckResult {
  allowed: boolean
  reason?: string
  count24h?: number
  count7d?: number
}

const COUNTABLE_STATUSES = new Set(['sent', 'delivered', 'opened', 'clicked'])

/**
 * Returns whether sending ONE more email to this contact would stay inside
 * the cap. Counts emails sent (or delivered/opened/clicked) in the last 24h
 * and 7d, excluding any emails whose `topicId` is in `exemptTopics`.
 *
 * NOTE: existing `emails` docs may not have a `topicId` field — those count
 * by default (treated as the broadcast/sequence default topic).
 */
export async function isWithinFrequencyCap(
  orgId: string,
  contactId: string,
  topicId: string,
): Promise<FrequencyCheckResult> {
  if (!orgId || !contactId) {
    return { allowed: false, reason: 'missing orgId or contactId' }
  }

  const cfg = await getOrgFrequencyCap(orgId)
  if (!cfg.enabled) return { allowed: true }

  // Exempt topics never get capped themselves AND never count towards the cap.
  const exempt = new Set(cfg.exemptTopics)
  if (exempt.has(topicId)) return { allowed: true }

  const now = Date.now()
  const since7d = Timestamp.fromMillis(now - 7 * 24 * 60 * 60 * 1000)
  const since24h = Timestamp.fromMillis(now - 24 * 60 * 60 * 1000)

  // Pull all candidate emails in last 7d for this contact, then filter in mem
  // for exempt topics. One query covers both windows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection('emails') as any)
    .where('contactId', '==', contactId)
    .where('sentAt', '>=', since7d)
    .get()

  let count7d = 0
  let count24h = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of snap.docs as any[]) {
    const data = d.data() ?? {}
    if (data.deleted === true) continue
    const status = typeof data.status === 'string' ? data.status : ''
    if (!COUNTABLE_STATUSES.has(status)) continue
    const t = typeof data.topicId === 'string' ? data.topicId : ''
    if (t && exempt.has(t)) continue
    count7d++
    const sentAt = data.sentAt as Timestamp | null | undefined
    if (sentAt && sentAt.toMillis() >= since24h.toMillis()) count24h++
  }

  if (cfg.maxPer24Hours > 0 && count24h >= cfg.maxPer24Hours) {
    return {
      allowed: false,
      reason: `cap: ${count24h}/${cfg.maxPer24Hours} in last 24h`,
      count24h,
      count7d,
    }
  }
  if (cfg.maxPer7Days > 0 && count7d >= cfg.maxPer7Days) {
    return {
      allowed: false,
      reason: `cap: ${count7d}/${cfg.maxPer7Days} in last 7d`,
      count24h,
      count7d,
    }
  }
  return { allowed: true, count24h, count7d }
}

/**
 * Records a frequency_skip activity row so admins can see WHY a contact
 * didn't receive a particular send. Best-effort — never throws.
 */
export async function logFrequencySkip(args: {
  orgId: string
  contactId: string
  topicId: string
  source: 'broadcast' | 'campaign' | 'sequence' | 'transactional'
  sourceId: string
  reason: string
}): Promise<void> {
  try {
    await adminDb.collection('frequency_skips').add({
      orgId: args.orgId,
      contactId: args.contactId,
      topicId: args.topicId,
      source: args.source,
      sourceId: args.sourceId,
      reason: args.reason,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[frequency] skip log failed', err)
  }
}
