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
import { isValidIanaTimezone } from '@/lib/email/send-time'

export const dynamic = 'force-dynamic'

type OrgData = Record<string, unknown> & {
  members?: Array<{ userId?: string; role?: unknown }>
  billingDetails?: Record<string, unknown>
  settings?: Record<string, unknown>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function defaultSenderPayload(org: OrgData): { name: string; email: string } {
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const sender = (settings.defaultSender ?? {}) as Record<string, unknown>
  return {
    name: typeof sender.name === 'string' ? sender.name : '',
    email: typeof sender.email === 'string' ? sender.email : '',
  }
}

// Canonical storage is `settings.timezone` — the same field the org creation
// route, the admin org settings page, and every send-time/analytics consumer
// (lib/email/send-time.ts callers in app/api/cron/{sequences,broadcasts},
// lib/email-analytics/aggregate.ts) read. A legacy top-level `org.timezone`
// field existed only in this portal route and was never read by anything
// else, so PATCH here silently no-op'd for send-time purposes. We keep
// reading the legacy field as a fallback so orgs that only ever saved via
// this route don't regress, but all new writes go to `settings.timezone`.
function orgTimezone(org: OrgData): string {
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const nested = typeof settings.timezone === 'string' ? settings.timezone.trim() : ''
  if (nested) return nested
  const legacy = typeof org.timezone === 'string' ? org.timezone.trim() : ''
  if (legacy) return legacy
  return 'Africa/Johannesburg'
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
  const isPrivileged = role === 'owner' || role === 'admin'
  const billingDetailsForRole = isPrivileged
    ? org.billingDetails
    : publicBillingDetails(org.billingDetails)

  return {
    organization: {
      id: orgId,
      name: typeof org.name === 'string' ? org.name : '',
      slug: typeof org.slug === 'string' ? org.slug : '',
      website: typeof org.website === 'string' ? org.website : '',
      industry: typeof org.industry === 'string' ? org.industry : '',
      billingEmail: typeof org.billingEmail === 'string' ? org.billingEmail : '',
      timezone: orgTimezone(org),
      billingDetails: billingDetailsForRole,
      defaultSender: defaultSenderPayload(org),
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

    // Timezone — canonical storage is `settings.timezone` (dot-path write so
    // sibling settings keys like brandColors/permissions/customDomain aren't
    // clobbered). This is the same field the org creation route, the admin
    // org settings page, and every send-time/analytics consumer read.
    let timezoneChanged = false
    if (timezone !== undefined && timezone) {
      if (!isValidIanaTimezone(timezone)) {
        return apiError('Timezone must be a valid IANA timezone identifier (e.g. Africa/Johannesburg)', 400)
      }
      updates['settings.timezone'] = timezone
      timezoneChanged = true
    }
    if (body.billingDetails && typeof body.billingDetails === 'object') {
      // Owners and admins can edit banking details (strict superset of admin rights).
      // Members and viewers cannot (blocked at the canEdit gate above).
      const allowBanking = role === 'owner' || role === 'admin'
      updates.billingDetails = mergeBillingDetailsForWrite(body.billingDetails, org.billingDetails, {
        allowBankingDetails: allowBanking,
      })
    }

    // Default sender name/email — stored on the org under settings.defaultSender.
    // Use dot-path writes so we never clobber sibling settings keys
    // (brandColors, permissions, customDomain, roleMatrix).
    const existingSender = defaultSenderPayload(org)
    const senderUpdate: { name: string; email: string } = { ...existingSender }
    let senderChanged = false

    const defaultSenderName = cleanString(body.defaultSenderName)
    if (defaultSenderName !== undefined) {
      senderUpdate.name = defaultSenderName
      senderChanged = true
    }

    const defaultSenderEmail = cleanEmail(body.defaultSenderEmail)
    if (defaultSenderEmail !== undefined) {
      if (defaultSenderEmail && !EMAIL_RE.test(defaultSenderEmail)) {
        return apiError('Default sender email must be a valid email address', 400)
      }
      senderUpdate.email = defaultSenderEmail
      senderChanged = true
    }

    if (senderChanged) {
      updates['settings.defaultSender'] = senderUpdate
    }

    await orgRef.update(updates)

    const nextSettings = senderChanged || timezoneChanged
      ? {
          ...(org.settings ?? {}),
          ...(senderChanged ? { defaultSender: senderUpdate } : {}),
          ...(timezoneChanged ? { timezone } : {}),
        }
      : org.settings
    const nextOrg = { ...org, ...updates, settings: nextSettings }
    await syncPlatformCompanyAgreementFieldsForOrg({ clientOrgId: orgId, clientOrg: nextOrg }).catch((err) => {
      console.error('[portal-organization-agreement-company-sync-error]', err)
    })

    return NextResponse.json({ updated: true, ...organizationPayload(orgId, nextOrg, role) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
