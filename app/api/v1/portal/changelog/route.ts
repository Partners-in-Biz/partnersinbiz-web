import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withPortalAuth } from '@/lib/auth/portal-middleware'

export const dynamic = 'force-dynamic'

interface ChangelogRelease {
  id: string
  version: string
  date: string
  title: string
  notes: string[]
}

// Seed entries reflecting recent QA / platform work. Inserted once if the
// `changelog` collection is empty.
const SEED_RELEASES: Omit<ChangelogRelease, 'id'>[] = [
  {
    version: '2.4.0',
    date: '2026-06-20',
    title: 'Security hardening',
    notes: [
      'Two-factor authentication for all accounts',
      'Active session management with remote sign-out',
      'Full audit log of account activity',
      'Hardened, recoverable account deletion with a 30-day recovery window',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-06-10',
    title: 'Settings & data controls',
    notes: [
      'Personal API keys with rotation',
      'Custom domains for client portals',
      'One-click data export',
      'Per-workspace feature flags',
    ],
  },
  {
    version: '2.2.0',
    date: '2026-05-28',
    title: 'Productivity & navigation',
    notes: [
      'Command palette (Cmd+K) for fast search',
      'Keyboard shortcuts for navigation (G then D/C/E/S/O)',
      'Client role with a streamlined sidebar',
      'What’s new changelog with unread tracking',
    ],
  },
]

async function ensureSeeded(): Promise<void> {
  const existing = await adminDb.collection('changelog').limit(1).get()
  if (!existing.empty) return
  const batch = adminDb.batch()
  for (const release of SEED_RELEASES) {
    const ref = adminDb.collection('changelog').doc()
    batch.set(ref, { ...release, createdAt: FieldValue.serverTimestamp() })
  }
  await batch.commit()
}

function toMillis(value: unknown): number {
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? 0 : t
  }
  if (value && typeof value === 'object') {
    const v = value as { _seconds?: number; seconds?: number; toMillis?: () => number }
    if (typeof v.toMillis === 'function') return v.toMillis()
    if (typeof v._seconds === 'number') return v._seconds * 1000
    if (typeof v.seconds === 'number') return v.seconds * 1000
  }
  return 0
}

/**
 * GET /api/v1/portal/changelog
 * Returns changelog releases (date desc), the caller's lastReadAt, and a
 * computed unreadCount. Seeds the collection on first access if empty.
 */
export const GET = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    await ensureSeeded()

    const [snap, userSnap] = await Promise.all([
      adminDb.collection('changelog').orderBy('date', 'desc').get(),
      adminDb.collection('users').doc(uid).get(),
    ])

    const releases: ChangelogRelease[] = snap.docs.map((doc) => {
      const d = doc.data()
      return {
        id: doc.id,
        version: String(d.version ?? ''),
        date: String(d.date ?? ''),
        title: String(d.title ?? ''),
        notes: Array.isArray(d.notes) ? d.notes.map((n: unknown) => String(n)) : [],
      }
    })

    const lastReadRaw = userSnap.data()?.changelogLastReadAt
    const lastReadAtMs = toMillis(lastReadRaw)
    const lastReadAt = lastReadAtMs ? new Date(lastReadAtMs).toISOString() : null

    const unreadCount = releases.filter((r) => toMillis(r.date) > lastReadAtMs).length

    return apiSuccess({ releases, lastReadAt, unreadCount })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

/**
 * POST /api/v1/portal/changelog
 * Marks the changelog as read for the caller (users/{uid}.changelogLastReadAt).
 */
export const POST = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    await adminDb
      .collection('users')
      .doc(uid)
      .set({ changelogLastReadAt: FieldValue.serverTimestamp() }, { merge: true })
    return apiSuccess({ ok: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
