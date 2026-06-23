/**
 * GET  /api/v1/email/domains?orgId=...  — list verified-domain configs for an org
 * POST /api/v1/email/domains             — register a new sending domain via Resend
 *
 * Body (POST): { orgId, name }
 * Auth: admin
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getResendClient } from '@/lib/email/resend'
import { isValidDomainName, type EmailDomain, type EmailDomainDnsRecord } from '@/lib/email/domains'
import { assertEmailDomainRegistrationAllowed } from '@/lib/email/policy'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  const snap = await adminDb
    .collection('email_domains')
    .where('orgId', '==', orgId)
    .get()

  const domains = snap.docs
    .map((d: any) => ({ id: d.id, ...d.data() }) as EmailDomain)
    .filter((d) => d.deleted !== true)

  return apiSuccess(domains)
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : ''
  if (!isValidDomainName(name)) return apiError('Invalid domain name', 400)
  const policy = await assertEmailDomainRegistrationAllowed(name)
  if (!policy.allowed) {
    return apiError(policy.error ?? 'Sending domain blocked by platform policy', policy.status ?? 403)
  }

  // Reject duplicates within the same org
  const existing = await adminDb
    .collection('email_domains')
    .where('orgId', '==', orgId)
    .where('name', '==', name)
    .where('deleted', '==', false)
    .limit(1)
    .get()
  if (!existing.empty) return apiError('Domain already registered for this org', 409)

  // Create domain in Resend
  const resend = getResendClient()
  const { data, error } = await resend.domains.create({ name })
  if (error || !data) {
    return apiError(error?.message ?? 'Resend rejected the domain', 502)
  }

  const dnsRecords: EmailDomainDnsRecord[] = ((data as { records?: EmailDomainDnsRecord[] }).records ?? []).map((r) => ({
    record: r.record,
    name: r.name,
    type: r.type,
    ttl: r.ttl,
    status: r.status,
    value: r.value,
    priority: r.priority,
  }))

  const docRef = await adminDb.collection('email_domains').add({
    orgId,
    name,
    resendDomainId: data.id,
    status: data.status ?? 'pending',
    region: data.region ?? '',
    dnsRecords,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastSyncedAt: FieldValue.serverTimestamp(),
    platformApprovalStatus: policy.autoApprove ? 'approved' : 'pending_review',
    platformApprovedByRuleId: policy.autoApprove ? policy.matchedRuleId ?? null : null,
    deleted: false,
  })

  return apiSuccess({ id: docRef.id, resendDomainId: data.id, status: data.status, dnsRecords }, 201)
})
