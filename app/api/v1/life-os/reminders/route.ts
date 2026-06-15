import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  buildReminderPreferences,
  buildReminderRecord,
  evaluateReminderDue,
  preferenceId,
  type ReminderCandidate,
  type ReminderPreferences,
  type ReminderPreferencesInput,
  type ReminderRecord,
} from '@/lib/self-improvement/reminders'

export const dynamic = 'force-dynamic'

interface ReminderPostBody {
  orgId?: string
  ownerId?: string
  candidates?: ReminderCandidate[]
}

function preferencesCollection() {
  return adminDb.collection('life_os_reminder_preferences')
}

function remindersCollection() {
  return adminDb.collection('life_os_reminders')
}

async function loadPreferences(orgId: string, ownerId: string, now = new Date().toISOString()) {
  const id = preferenceId(orgId, ownerId)
  const doc = await preferencesCollection().doc(id).get()
  if (doc.exists) return { id, ...doc.data() } as ReminderPreferences
  return buildReminderPreferences({ orgId, ownerId }, now)
}

function cleanLimit(value: string | null) {
  const parsed = Number(value ?? 100)
  if (!Number.isFinite(parsed) || parsed < 1) return 100
  return Math.min(Math.floor(parsed), 200)
}

function canAccessOwner(user: { uid: string; role?: string }, ownerId: string) {
  return ownerId === user.uid || user.role === 'admin' || user.role === 'super_admin'
}

function mergePreferenceInput(existing: ReminderPreferences, body: ReminderPreferencesInput): ReminderPreferencesInput {
  return {
    orgId: existing.orgId,
    ownerId: existing.ownerId,
    optedIn: body.optedIn ?? existing.optedIn,
    channels: { ...existing.channels, ...body.channels },
    quietHours: { ...existing.quietHours, ...body.quietHours },
    enabledKinds: body.enabledKinds ?? existing.enabledKinds,
  }
}

export const GET = withAuth('client', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')?.trim()
  const ownerId = searchParams.get('ownerId')?.trim() || user.uid
  const limit = cleanLimit(searchParams.get('limit'))

  if (!orgId) return apiError('orgId is required; pass it as a query param')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!canAccessOwner(user, ownerId)) return apiError('Forbidden', 403)

  const preferences = await loadPreferences(orgId, ownerId)
  let query = remindersCollection().where('orgId', '==', orgId)
  query = query.where('ownerId', '==', ownerId)
  const snapshot = await query.orderBy('scheduledFor', 'asc').limit(limit).get()
  const reminders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ReminderRecord)

  return apiSuccess({ preferences, reminders }, 200, { total: reminders.length, page: 1, limit })
})

export const PATCH = withAuth('client', async (req, user) => {
  const body = (await req.json()) as ReminderPreferencesInput
  const orgId = body.orgId?.trim()
  const ownerId = body.ownerId?.trim() || user.uid
  if (!orgId) return apiError('orgId is required')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!canAccessOwner(user, ownerId)) return apiError('Forbidden', 403)

  try {
    const now = new Date().toISOString()
    const existing = await loadPreferences(orgId, ownerId, now)
    const preferences = buildReminderPreferences(mergePreferenceInput(existing, { ...body, orgId, ownerId }), now)
    await preferencesCollection().doc(preferences.id).set(preferences, { merge: true })
    return apiSuccess(preferences)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid reminder preferences payload')
  }
})

export const POST = withAuth('client', async (req, user) => {
  const body = (await req.json()) as ReminderPostBody
  const orgId = body.orgId?.trim()
  const ownerId = body.ownerId?.trim() || user.uid
  if (!orgId) return apiError('orgId is required')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!canAccessOwner(user, ownerId)) return apiError('Forbidden', 403)

  try {
    const now = new Date().toISOString()
    const preferences = await loadPreferences(orgId, ownerId, now)
    const candidates = (body.candidates ?? []).map((candidate) => ({
      ...candidate,
      orgId,
      ownerId,
      timezone: candidate.timezone || preferences.quietHours.timezone,
    }))
    const dueResults = candidates.map((candidate) => evaluateReminderDue(candidate, preferences, now))
    const allowedCandidates = candidates.filter((_, index) => {
      const reason = dueResults[index].reason
      return reason !== 'consent-required' && reason !== 'kind-disabled' && reason !== 'notification-channel-disabled'
    })
    const suppressed = candidates
      .map((candidate, index) => ({ kind: candidate.kind, target: candidate.target, reason: dueResults[index].reason }))
      .filter((item) => item.reason === 'consent-required' || item.reason === 'kind-disabled' || item.reason === 'notification-channel-disabled')
    const reminders = allowedCandidates.map((candidate) => buildReminderRecord(candidate, preferences, now))
    const created = []

    for (const reminder of reminders) {
      await remindersCollection().doc(reminder.id).set(reminder, { merge: true })
      created.push(reminder)
    }

    return apiSuccess({ created, suppressed }, 201, { total: created.length, page: 1, limit: created.length })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid reminder schedule payload')
  }
})
