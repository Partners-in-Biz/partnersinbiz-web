// app/api/v1/account/notification-preferences/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const CATEGORIES = ['email', 'crm', 'social', 'reports', 'billing'] as const
type Category = (typeof CATEGORIES)[number]

type CategoryPref = { inApp: boolean; email: boolean }
type Preferences = Record<Category, CategoryPref>

function defaults(): Preferences {
  return CATEGORIES.reduce((acc, cat) => {
    acc[cat] = { inApp: true, email: true }
    return acc
  }, {} as Preferences)
}

function normalize(raw: unknown): Preferences {
  const base = defaults()
  if (raw && typeof raw === 'object') {
    for (const cat of CATEGORIES) {
      const v = (raw as Record<string, unknown>)[cat]
      if (v && typeof v === 'object') {
        const entry = v as Record<string, unknown>
        base[cat] = {
          inApp: entry.inApp !== false,
          email: entry.email !== false,
        }
      }
    }
  }
  return base
}

export const GET = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    const userDoc = await adminDb.collection('users').doc(uid).get()
    const prefs = normalize(userDoc.data()?.notificationPreferences)
    return apiSuccess({ preferences: prefs })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const body = await req.json().catch(() => ({}))
    const incoming = body?.preferences ?? body
    if (!incoming || typeof incoming !== 'object') {
      return apiError('preferences object is required', 400)
    }

    // Validate: every provided category must be a known one with boolean fields.
    for (const key of Object.keys(incoming)) {
      if (!CATEGORIES.includes(key as Category)) {
        return apiError(`Unknown notification category: ${key}`, 400)
      }
      const entry = (incoming as Record<string, unknown>)[key]
      if (!entry || typeof entry !== 'object') {
        return apiError(`Invalid value for category: ${key}`, 400)
      }
    }

    const prefs = normalize(incoming)

    await adminDb
      .collection('users')
      .doc(uid)
      .set(
        { notificationPreferences: prefs, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )

    return apiSuccess({ preferences: prefs })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
