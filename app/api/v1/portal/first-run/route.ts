import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'

import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'

export const dynamic = 'force-dynamic'

type RecordLike = Record<string, unknown>

function asRecord(value: unknown): RecordLike {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {}
}

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 500) : fallback
}

function cleanStringList(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
    .slice(0, limit)
}

function cleanNumber(value: unknown, min: number, max: number) {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numberValue)) return null
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}

function cleanIdentity(value: unknown, fallbackName = '') {
  const record = asRecord(value)
  return {
    preferredName: cleanString(record.preferredName, fallbackName),
    pronouns: cleanString(record.pronouns),
    location: cleanString(record.location),
  }
}

function cleanLifeDomains(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const record = asRecord(item)
      const label = cleanString(record.label)
      if (!label) return null
      return {
        key: cleanString(record.key, label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `domain-${index + 1}`),
        label,
        priority: cleanNumber(record.priority, 1, 5) ?? 3,
        notes: cleanString(record.notes),
      }
    })
    .filter((item): item is { key: string; label: string; priority: number; notes: string } => Boolean(item))
    .slice(0, 10)
}

function cleanGoals(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = asRecord(item)
      const title = cleanString(record.title)
      if (!title) return null
      return {
        title,
        domain: cleanString(record.domain),
        timeframe: cleanString(record.timeframe),
      }
    })
    .filter((item): item is { title: string; domain: string; timeframe: string } => Boolean(item))
    .slice(0, 10)
}

function cleanBaseline(value: unknown) {
  const record = asRecord(value)
  return {
    confidence: cleanNumber(record.confidence, 1, 10),
    energy: cleanNumber(record.energy, 1, 10),
    timeCapacityHours: cleanNumber(record.timeCapacityHours, 0, 168),
  }
}

function cleanPrivacy(value: unknown) {
  const record = asRecord(value)
  return {
    consentToStore: record.consentToStore === true,
    shareWithTeam: record.shareWithTeam === true,
    allowAgentPersonalization: record.allowAgentPersonalization === true,
  }
}

function defaultFirstRun(member: RecordLike) {
  const preferredName = [cleanString(member.firstName), cleanString(member.lastName)].filter(Boolean).join(' ')
  return {
    completed: false,
    identity: { preferredName, pronouns: '', location: '' },
    values: [] as string[],
    lifeDomains: [] as Array<{ key: string; label: string; priority: number; notes: string }>,
    constraints: [] as string[],
    goals: [] as Array<{ title: string; domain: string; timeframe: string }>,
    baseline: { confidence: null as number | null, energy: null as number | null, timeCapacityHours: null as number | null },
    privacy: { consentToStore: false, shareWithTeam: false, allowAgentPersonalization: false },
  }
}

function cleanExistingFirstRun(value: unknown, member: RecordLike) {
  const fallback = defaultFirstRun(member)
  const record = asRecord(value)
  if (!Object.keys(record).length) return fallback
  return {
    completed: record.completed === true,
    identity: cleanIdentity(record.identity, fallback.identity.preferredName),
    values: cleanStringList(record.values),
    lifeDomains: cleanLifeDomains(record.lifeDomains),
    constraints: cleanStringList(record.constraints),
    goals: cleanGoals(record.goals),
    baseline: cleanBaseline(record.baseline),
    privacy: cleanPrivacy(record.privacy),
  }
}

function cleanPayload(body: unknown, member: RecordLike) {
  const record = asRecord(body)
  const fallback = defaultFirstRun(member)
  return {
    completed: true,
    identity: cleanIdentity(record.identity, fallback.identity.preferredName),
    values: cleanStringList(record.values),
    lifeDomains: cleanLifeDomains(record.lifeDomains),
    constraints: cleanStringList(record.constraints),
    goals: cleanGoals(record.goals),
    baseline: cleanBaseline(record.baseline),
    privacy: cleanPrivacy(record.privacy),
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

async function firstRunModuleGuard(orgId: string) {
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return apiError('Organisation not found', 404)
  const org = orgSnap.data() ?? {}
  if (!isPortalModuleEnabled(org.settings, 'firstRunFlow')) {
    return apiError('First-run setup is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'firstRunFlow',
    })
  }
  return null
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, uid: string, orgId: string) => {
  try {
    const guard = await firstRunModuleGuard(orgId)
    if (guard) return guard

    const memberSnap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    const member = memberSnap.exists ? (memberSnap.data() ?? {}) : {}
    return apiSuccess({
      portalModule: 'firstRunFlow',
      firstRun: cleanExistingFirstRun(member.firstRunFlow, member),
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string) => {
  try {
    const guard = await firstRunModuleGuard(orgId)
    if (guard) return guard

    const memberRef = adminDb.collection('orgMembers').doc(`${orgId}_${uid}`)
    const memberSnap = await memberRef.get()
    const member = memberSnap.exists ? (memberSnap.data() ?? {}) : {}
    const body = await req.json().catch(() => ({}))
    const firstRunFlow = cleanPayload(body, member)

    if (!firstRunFlow.privacy.consentToStore) {
      return apiError('Storage consent is required before saving first-run answers', 400)
    }

    await memberRef.set(
      {
        orgId,
        uid,
        firstRunFlow,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!memberSnap.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    )

    return apiSuccess({ portalModule: 'firstRunFlow', firstRun: firstRunFlow })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
