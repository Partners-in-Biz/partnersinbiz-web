// app/api/v1/email-templates/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue } from 'firebase-admin/firestore'
import { actorFrom } from '@/lib/api/actor'
import { validateDocument } from '@/lib/email-builder/validate'
import { STARTER_TEMPLATES, type EmailTemplate, type TemplateCategory } from '@/lib/email-builder/templates'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import { applyBrandKitToTheme } from '@/lib/brand-kit/applyToDocument'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const CATEGORIES: TemplateCategory[] = ['newsletter', 'welcome', 'product-launch', 'reengagement', 'transactional', 'custom']

function isCategory(v: unknown): v is TemplateCategory {
  return typeof v === 'string' && (CATEGORIES as string[]).includes(v)
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const categoryParam = searchParams.get('category')
  const category: TemplateCategory | null = isCategory(categoryParam) ? categoryParam : null

  // Org-specific templates from Firestore
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = adminDb.collection('email_templates').where('orgId', '==', orgId)
  const snap = await query.get()
  const orgTemplates = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((t: any) => t.deleted !== true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((t: any) => ({
      ...t,
      createdAt: t.createdAt?.toDate?.()?.toISOString?.() ?? t.createdAt ?? null,
      updatedAt: t.updatedAt?.toDate?.()?.toISOString?.() ?? t.updatedAt ?? null,
    }))

  const starters: EmailTemplate[] = STARTER_TEMPLATES
  const merged: EmailTemplate[] = [...orgTemplates, ...starters]
  const filtered = category ? merged.filter((t) => t.category === category) : merged

  // Sort: starters last (so user's own work appears first when no category filter)
  filtered.sort((a, b) => {
    if (a.isStarter !== b.isStarter) return a.isStarter ? 1 : -1
    const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return bt - at
  })

  return apiSuccess(filtered, 200, { total: filtered.length, page: 1, limit: filtered.length })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Body required', 400)
  const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  if (typeof body.name !== 'string' || body.name.trim().length === 0) return apiError('name is required', 400)
  if (!isCategory(body.category)) return apiError('category is required and must be one of ' + CATEGORIES.join(', '), 400)

  const v = validateDocument(body.document)
  if (!v.ok) return apiError('Invalid document: ' + v.errors.join('; '), 400)

  // Auto-apply the org's brand kit so new templates pick up colors / fonts
  // and the org name/address/social are populated on any empty footer fields.
  // Skipped explicitly when `applyBrandKit: false` is passed.
  const skipBrandKit = body.applyBrandKit === false
  const finalDocument = skipBrandKit
    ? v.doc
    : applyBrandKitToTheme(v.doc, await getBrandKitForOrg(orgId))

  const docData = {
    orgId,
    name: body.name.trim(),
    description: typeof body.description === 'string' ? body.description : '',
    category: body.category,
    document: finalDocument,
    isStarter: false,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...actorFrom(user),
  }

  const ref = await adminDb.collection('email_templates').add(docData)
  return apiSuccess({ id: ref.id, ...docData, createdAt: null, updatedAt: null }, 201)
})
