import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  buildReminderPreferences,
  buildReminderSchedule,
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

export const GET = withAuth('client', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')?.trim()
  const ownerId = searchParams.get('ownerId')?.trim() || user.uid
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 200)

  if (!orgId) return apiError('orgId is required; pass it as a query param')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const preferences = await loadPreferences(orgId, ownerId)
  let query = remindersCollection().where('orgId', '==', orgId)
  query = query.where('ownerId', '==', ownerId)
  const snapshot = await query.orderBy('scheduledFor', 'asc').get()
  const reminders = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ReminderRecord)
    .slice(0, limit)

  return apiSuccess({ preferences, reminders }, 200, { total: reminders.length, page: 1, limit })
})

export const PATCH = withAuth('client', async (req, user) => {
  const body = (await req.json()) as ReminderPreferencesInput
  const orgId = body.orgId?.trim()
  const ownerId = body.ownerId?.trim() || user.uid
  if (!orgId) return apiError('orgId is required')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  try {
    const now = new Date().toISOString()
    const preferences = buildReminderPreferences({ ...body, orgId, ownerId }, now)
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

  try {
    const now = new Date().toISOString()
    const preferences = await loadPreferences(orgId, ownerId, now)
    const candidates = (body.candidates ?? []).map((candidate) => ({
      ...candidate,
      orgId,
      ownerId,
      timezone: candidate.timezone || preferences.quietHours.timezone,
    }))
    const reminders = buildReminderSchedule(candidates, preferences, now)
    const created = []

    for (const reminder of reminders) {
      const doc = await remindersCollection().add(reminder)
      created.push({ ...reminder, id: doc.id })
    }

    return apiSuccess({ created }, 201, { total: created.length, page: 1, limit: created.length })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid reminder schedule payload')
  }
})
