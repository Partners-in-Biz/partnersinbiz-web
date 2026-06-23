/**
 * Admin email domain allow/block ruleset — `admin_email_domain_rules`.
 *
 * GET    /api/v1/admin/email/domains            — list all rules (allow + block).
 * POST   /api/v1/admin/email/domains            — create a rule.
 *          Body: { domain, type: 'allow'|'block', reason?, autoApprove? }
 * DELETE /api/v1/admin/email/domains?id=         — remove a rule.
 *
 * ENFORCEMENT NOTE: these rules are an allowlist/blocklist that the email
 * domain-verification path (lib/email/domains + app/api/v1/email/domains)
 * SHOULD consult before letting an org add/verify a sending domain — a 'block'
 * match denies, an 'allow' + autoApprove match can fast-track verification.
 * The matcher (`./matcher`, exported `evaluateAddress` / `matchDomainRule`) is
 * the single place that logic lives. Wiring the call into the verification path
 * is outside this feature's allowed dirs — see the handoff report.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import type { DomainRule, DomainRuleType } from './matcher'

export const dynamic = 'force-dynamic'

const COLLECTION = 'admin_email_domain_rules'

// A rule's `domain` is an exact domain or a glob pattern. Validate that it's at
// least a plausible domain/pattern: lowercase, dots, optional `*`, optional
// leading local-part wildcard ("*@gmail.com").
function isValidPattern(input: string): boolean {
  const v = (input ?? '').trim().toLowerCase()
  if (!v || v.length > 253) return false
  // Allow letters, digits, dots, dashes, one optional '@', and '*' wildcards.
  if (!/^[a-z0-9.*@-]+$/.test(v)) return false
  // Must contain at least one dot (a TLD) somewhere.
  if (!v.includes('.')) return false
  return true
}

function tsToIso(v: unknown): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (v as any)?.toDate?.()
  return d instanceof Date ? d.toISOString() : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRule(d: any): DomainRule {
  const data = d.data() ?? {}
  return {
    id: d.id,
    domain: data.domain ?? '',
    type: (data.type === 'block' ? 'block' : 'allow') as DomainRuleType,
    reason: data.reason ?? '',
    autoApprove: !!data.autoApprove,
    createdBy: data.createdBy ?? '',
    createdByType: data.createdByType ?? '',
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  }
}

export const GET = withAuth('admin', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any
  try {
    snap = await adminDb.collection(COLLECTION).orderBy('createdAt', 'desc').get()
  } catch {
    snap = await adminDb.collection(COLLECTION).get()
  }
  const rules = snap.docs.map(toRule)
  return apiSuccess({
    allow: rules.filter((r: DomainRule) => r.type === 'allow'),
    block: rules.filter((r: DomainRule) => r.type === 'block'),
  })
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => ({}))
  const domain = (typeof body.domain === 'string' ? body.domain : '').trim().toLowerCase()
  const type: DomainRuleType = body.type === 'block' ? 'block' : 'allow'
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  const autoApprove = type === 'allow' ? !!body.autoApprove : false

  if (!isValidPattern(domain)) {
    return apiError('domain must be a valid domain or pattern (e.g. acme.co.za or *.acme.co.za)')
  }

  // Doc id is deterministic per (type, pattern) so re-adding the same rule
  // upserts rather than duplicating.
  const id = `${type}__${domain.replace(/[^a-z0-9.*@-]/g, '_')}`
  const ref = adminDb.collection(COLLECTION).doc(id)
  const exists = (await ref.get()).exists

  const actor = actorFrom(user)
  await ref.set(
    {
      domain,
      type,
      reason,
      autoApprove,
      ...(exists ? {} : { ...actor, createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  const fresh = await ref.get()
  return apiSuccess(toRule(fresh), exists ? 200 : 201)
})

export const DELETE = withAuth('admin', async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const id = (searchParams.get('id') ?? '').trim()
  if (!id) return apiError('id is required')
  const ref = adminDb.collection(COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Rule not found', 404)
  await ref.delete()
  return apiSuccess({ id, deleted: true })
})
