/**
 * GET    /api/v1/organizations/[id] — get org details
 * PUT    /api/v1/organizations/[id] — update org
 * DELETE /api/v1/organizations/[id] — soft delete (active: false)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { slugify, isMember, isOwnerOrAdmin, isOwner } from '@/lib/organizations/helpers'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { mergeBillingDetailsForWrite } from '@/lib/organizations/billing-details'
import { syncPlatformCompanyAgreementFieldsForOrg } from '@/lib/platform-owner/relationships'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const doc = await adminDb.collection('organizations').doc(id).get()
  if (!doc.exists) return apiError('Organisation not found', 404)

  const data = doc.data()!
  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)
  // This guard is unreachable with current roles ('admin', 'client', 'ai') because withAuth('admin') blocks clients.
  // Kept intentionally for when lower-privilege roles are introduced.
  // Non-admin roles must be a member
  if (user.role !== 'admin' && user.role !== 'ai') {
    if (!isMember(data.members ?? [], user.uid)) return apiError('Forbidden', 403)
  }

  return apiSuccess({ id: doc.id, ...data })
})

export const PUT = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const doc = await adminDb.collection('organizations').doc(id).get()
  if (!doc.exists) return apiError('Organisation not found', 404)

  const data = doc.data()!
  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)
  // This guard is unreachable with current roles ('admin', 'client', 'ai') because withAuth('admin') blocks clients.
  // Kept intentionally for when lower-privilege roles are introduced.
  if (user.role !== 'admin' && user.role !== 'ai') {
    if (!isOwnerOrAdmin(data.members ?? [], user.uid)) return apiError('Forbidden', 403)
  }

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (typeof body.name === 'string' && body.name.trim()) {
    const newName = body.name.trim()
    const newSlug = slugify(newName)
    // Check slug uniqueness (allow same org)
    if (newSlug !== data.slug) {
      const existing = await adminDb.collection('organizations').where('slug', '==', newSlug).get()
      if (!existing.empty) return apiError(`Slug "${newSlug}" already taken`, 409)
    }
    updates.name = newName
    updates.slug = newSlug
  }
  if (typeof body.description === 'string') updates.description = body.description.trim()
  if (typeof body.logoUrl === 'string') updates.logoUrl = body.logoUrl.trim()
  if (typeof body.website === 'string') updates.website = body.website.trim()
  if (typeof body.industry === 'string') updates.industry = body.industry.trim()
  if (typeof body.billingEmail === 'string') updates.billingEmail = body.billingEmail.trim()
  if (typeof body.status === 'string') updates.status = body.status.trim()
  if (typeof body.plan === 'string') updates.plan = body.plan.trim()
  if (body.brandProfile && typeof body.brandProfile === 'object') {
    updates.brandProfile = body.brandProfile
  }
  if (body.settings && typeof body.settings === 'object') {
    // Merge settings to avoid overwriting unrelated fields
    const existingSettings = data.settings ?? {}
    updates.settings = { ...existingSettings, ...body.settings }
  }
  if (body.billingDetails && typeof body.billingDetails === 'object') {
    updates.billingDetails = mergeBillingDetailsForWrite(body.billingDetails, data.billingDetails, {
      allowBankingDetails: true,
    })
  }

  await adminDb.collection('organizations').doc(id).update(updates)
  if (body.billingDetails && typeof body.billingDetails === 'object') {
    await syncPlatformCompanyAgreementFieldsForOrg({
      clientOrgId: id,
      clientOrg: { ...data, ...updates },
    }).catch((err) => {
      console.error('[organization-agreement-company-sync-error]', err)
    })
  }
  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const doc = await adminDb.collection('organizations').doc(id).get()
  if (!doc.exists) return apiError('Organisation not found', 404)

  const data = doc.data()!
  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)
  // This guard is unreachable with current roles ('admin', 'client', 'ai') because withAuth('admin') blocks clients.
  // Kept intentionally for when lower-privilege roles are introduced.
  if (user.role !== 'admin' && user.role !== 'ai') {
    if (!isOwner(data.members ?? [], user.uid)) return apiError('Forbidden — only owners can delete', 403)
  }

  await adminDb.collection('organizations').doc(id).update({
    active: false,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id, deleted: true })
})
