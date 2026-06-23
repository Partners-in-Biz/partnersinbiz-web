/**
 * GET  /api/v1/admin/demo-orgs — list demo organisations (isDemo == true).
 * POST /api/v1/admin/demo-orgs — tag an existing org as a demo org.
 *
 * A demo org is an `organizations` doc with isDemo:true and demo metadata
 * (demoPersona, demoToken, seededAt, resetAt). Seeded demo data lives as
 * `contacts` docs with demoSeed:true scoped to the org.
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
import {
  PERSONAS,
  isPersonaKey,
  generateDemoToken,
  countSeededDemoData,
} from './_shared'

export const dynamic = 'force-dynamic'

function tsToIso(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { _seconds?: number; seconds?: number; toDate?: () => Date }
  if (typeof v.toDate === 'function') {
    try { return v.toDate().toISOString() } catch { return null }
  }
  const seconds = v._seconds ?? v.seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  return null
}

export const GET = withAuth('admin', async (_req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)

  const snap = await adminDb.collection('organizations').where('isDemo', '==', true).get()

  const orgs = await Promise.all(
    snap.docs.map(async (doc) => {
      const d = doc.data() as Record<string, unknown>
      const persona = typeof d.demoPersona === 'string' ? d.demoPersona : null
      const demoToken = typeof d.demoToken === 'string' ? d.demoToken : null
      const seededContacts = await countSeededDemoData(doc.id).catch(() => 0)
      return {
        id: doc.id,
        name: typeof d.name === 'string' ? d.name : 'Untitled organisation',
        slug: typeof d.slug === 'string' ? d.slug : '',
        status: typeof d.status === 'string' ? d.status : 'active',
        persona,
        personaLabel: persona && persona in PERSONAS ? PERSONAS[persona as keyof typeof PERSONAS].label : null,
        demoToken,
        previewUrl: demoToken ? `/demo/${typeof d.slug === 'string' ? d.slug : doc.id}?token=${demoToken}` : null,
        seededAt: tsToIso(d.seededAt),
        resetAt: tsToIso(d.resetAt),
        seededContacts,
      }
    }),
  )

  orgs.sort((a, b) => (b.resetAt ?? b.seededAt ?? '').localeCompare(a.resetAt ?? a.seededAt ?? ''))

  return apiSuccess({ orgs, personas: Object.values(PERSONAS).map((p) => ({ key: p.key, label: p.label, description: p.description })) })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)

  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const persona = body.persona
  if (!orgId) return apiError('orgId is required', 400)
  if (!isPersonaKey(persona)) return apiError('persona must be one of: ' + Object.keys(PERSONAS).join(', '), 400)

  const ref = adminDb.collection('organizations').doc(orgId)
  const existing = await ref.get()
  if (!existing.exists) return apiError('Organisation not found', 404)

  const data = existing.data() as Record<string, unknown>
  // Reuse an existing token if already tagged, otherwise mint a fresh one.
  const demoToken = typeof data.demoToken === 'string' && data.demoToken ? data.demoToken : generateDemoToken()

  await ref.set({
    isDemo: true,
    demoPersona: persona,
    demoToken,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await writeAdminAudit(user, {
    action: 'demo_org.tag',
    orgId,
    summary: `Tagged "${data.name ?? orgId}" as a ${PERSONAS[persona].label} demo org`,
    metadata: { persona },
  })

  return apiSuccess({
    id: orgId,
    persona,
    demoToken,
    previewUrl: `/demo/${typeof data.slug === 'string' ? data.slug : orgId}?token=${demoToken}`,
  }, 201)
})
