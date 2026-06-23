/**
 * POST /api/v1/admin/demo-orgs/[id]/reset — 24h demo reset.
 *
 * Clears all demoSeed data for the org and re-seeds the persona, then records
 * resetAt. Idempotent: clear-then-seed always lands the same end state.
 *
 * Intended to run every 24h. There is no cron here — a scheduled job (e.g.
 * Vercel Cron or the platform scheduler) can POST this same endpoint per demo
 * org on a daily cadence; the button in /admin/demo-orgs triggers it manually.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { isPersonaKey, clearSeededDemoData, seedDemoData, PERSONAS } from '../../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { id } = await (ctx as RouteContext).params

  const ref = adminDb.collection('organizations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Organisation not found', 404)
  const data = snap.data() as Record<string, unknown>
  if (data.isDemo !== true) return apiError('Organisation is not tagged as a demo org', 400)
  const persona = data.demoPersona
  if (!isPersonaKey(persona)) return apiError('Demo org has no valid persona', 400)

  const removed = await clearSeededDemoData(id)
  const seeded = await seedDemoData(id, persona)
  await ref.set({
    resetAt: FieldValue.serverTimestamp(),
    seededAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await writeAdminAudit(user, {
    action: 'demo_org.reset',
    orgId: id,
    summary: `Reset "${data.name ?? id}" demo (removed ${removed}, re-seeded ${seeded} ${PERSONAS[persona].label} contacts)`,
    metadata: { persona, removed, seeded },
  })

  return apiSuccess({ id, removed, seededContacts: seeded })
})
