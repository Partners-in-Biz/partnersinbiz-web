import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import type { OrgRole } from '@/lib/organizations/types'
import { mergeBillingDetailsForWrite, publicBillingDetails } from '@/lib/organizations/billing-details'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'
import { syncPlatformCompanyAgreementFieldsForOrg } from '@/lib/platform-owner/relationships'

export const dynamic = 'force-dynamic'

type OrgData = Record<string, unknown> & {
  members?: Array<{ userId?: string; role?: unknown }>
  billingDetails?: Record<string, unknown>
}

function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && value in ROLE_RANK
}

type ResolvedOrg =
  | { ok: true; orgId: string }
  | { ok: false; response: Response }

async function resolveOrgId(req: NextRequest, uid: string): Promise<ResolvedOrg> {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) return { ok: false, response: apiError('User not found', 404) }

  const userData = userDoc.data() ?? {}
  const requestedOrgId = req.nextUrl.searchParams.get('orgId')?.trim() ?? ''
  if (requestedOrgId) {
    const allowed = await canUsePortalOrg(uid, userData, requestedOrgId)
    if (!allowed) return { ok: false, response: apiError('You do not have access to this organisation', 403) }
    return { ok: true, orgId: requestedOrgId }
  }

  const orgId = await resolvePortalActiveOrgId(uid, userData)
  if (!orgId) return { ok: false, response: apiError('No active workspace', 400) }
  return { ok: true, orgId }
}

function memberRole(org: OrgData, uid: string): OrgRole | null {
  const member = (org.members ?? []).find((item) => item.userId === uid)
  return isOrgRole(member?.role) ? member.role : null
}

function canEdit(role: OrgRole | null): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK.admin
}

function organizationPayload(orgId: string, org: OrgData, role: OrgRole | null) {
  return {
    organization: {
      id: orgId,
      name: typeof org.name === 'string' ? org.name : '',
      slug: typeof org.slug === 'string' ? org.slug : '',
      website: typeof org.website === 'string' ? org.website : '',
      industry: typeof org.industry === 'string' ? org.industry : '',
      billingEmail: typeof org.billingEmail === 'string' ? org.billingEmail : '',
      timezone: typeof org.timezone === 'string' ? org.timezone : 'Africa/Johannesburg',
      billingDetails: publicBillingDetails(org.billingDetails),
    },
    permissions: { canEdit: canEdit(role), role },
  }
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function cleanEmail(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined
}

export const GET = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const resolved = await resolveOrgId(req, uid)
    if (!resolved.ok) return resolved.response
    const { orgId } = resolved

    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)
    const org = orgDoc.data() as OrgData
    const role = memberRole(org, uid)

    return NextResponse.json(organizationPayload(orgId, org, role))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const resolved = await resolveOrgId(req, uid)
    if (!resolved.ok) return resolved.response
    const { orgId } = resolved

    const orgRef = adminDb.collection('organizations').doc(orgId)
    const orgDoc = await orgRef.get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)
    const org = orgDoc.data() as OrgData
    const role = memberRole(org, uid)
    if (!canEdit(role)) return apiError('Only workspace owners and admins can edit organisation details', 403)

    const body = await req.json().catch(() => ({}))
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

    const name = cleanString(body.name)
    const website = cleanString(body.website)
    const industry = cleanString(body.industry)
    const billingEmail = cleanEmail(body.billingEmail)
    const timezone = cleanString(body.timezone)

    if (name !== undefined && name) updates.name = name
    if (website !== undefined) updates.website = website
    if (industry !== undefined) updates.industry = industry
    if (billingEmail !== undefined) updates.billingEmail = billingEmail
    if (timezone !== undefined && timezone) updates.timezone = timezone
    if (body.billingDetails && typeof body.billingDetails === 'object') {
      updates.billingDetails = mergeBillingDetailsForWrite(body.billingDetails, org.billingDetails, {
        allowBankingDetails: false,
      })
    }

    await orgRef.update(updates)

    const nextOrg = { ...org, ...updates }
    await syncPlatformCompanyAgreementFieldsForOrg({ clientOrgId: orgId, clientOrg: nextOrg }).catch((err) => {
      console.error('[portal-organization-agreement-company-sync-error]', err)
    })

    return NextResponse.json({ updated: true, ...organizationPayload(orgId, nextOrg, role) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
