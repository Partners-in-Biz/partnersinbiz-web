import { readEmailControls } from '@/app/api/v1/admin/email/controls/store'
import { evaluateAddress, type DomainRule, type DomainRuleType } from '@/app/api/v1/admin/email/domains/matcher'
import { adminDb } from '@/lib/firebase/admin'

export interface EmailPolicyDecision {
  allowed: boolean
  status?: number
  error?: string
  action?: DomainRuleType | 'neutral'
  autoApprove?: boolean
  matchedRuleId?: string | null
}

function toRule(doc: FirebaseFirestore.QueryDocumentSnapshot): DomainRule {
  const data = doc.data() ?? {}
  return {
    id: doc.id,
    domain: typeof data.domain === 'string' ? data.domain : '',
    type: data.type === 'block' ? 'block' : 'allow',
    reason: typeof data.reason === 'string' ? data.reason : '',
    autoApprove: data.autoApprove === true,
    createdAt: null,
    updatedAt: null,
  }
}

async function readDomainRules(): Promise<DomainRule[]> {
  try {
    const snap = await adminDb.collection('admin_email_domain_rules').get()
    return snap.docs.map(toRule).filter((rule) => rule.domain)
  } catch {
    return []
  }
}

export async function assertOutboundEmailAllowed(input: {
  recipients: string[]
}): Promise<EmailPolicyDecision> {
  const controls = await readEmailControls().catch(() => ({
    pauseOutbound: false,
    pauseReason: null,
  }))

  if (controls.pauseOutbound) {
    return {
      allowed: false,
      status: 409,
      error: controls.pauseReason
        ? `Outbound email is paused platform-wide: ${controls.pauseReason}`
        : 'Outbound email is paused platform-wide.',
    }
  }

  const rules = await readDomainRules()
  if (rules.length === 0) return { allowed: true, action: 'neutral', autoApprove: false }

  for (const recipient of input.recipients) {
    const decision = evaluateAddress(recipient, rules)
    if (decision.action === 'block') {
      const reason = decision.rule?.reason?.trim()
      return {
        allowed: false,
        status: 403,
        error: reason
          ? `Recipient domain is blocked by platform policy: ${reason}`
          : 'Recipient domain is blocked by platform policy.',
        action: decision.action,
        matchedRuleId: decision.rule?.id ?? null,
      }
    }
  }

  return { allowed: true, action: 'neutral', autoApprove: false }
}

export async function assertEmailDomainRegistrationAllowed(domain: string): Promise<EmailPolicyDecision> {
  const rules = await readDomainRules()
  if (rules.length === 0) return { allowed: true, action: 'neutral', autoApprove: false }

  const decision = evaluateAddress(domain, rules)
  if (decision.action === 'block') {
    const reason = decision.rule?.reason?.trim()
    return {
      allowed: false,
      status: 403,
      error: reason
        ? `Sending domain is blocked by platform policy: ${reason}`
        : 'Sending domain is blocked by platform policy.',
      action: decision.action,
      matchedRuleId: decision.rule?.id ?? null,
      autoApprove: false,
    }
  }

  return {
    allowed: true,
    action: decision.action,
    autoApprove: decision.autoApprove,
    matchedRuleId: decision.rule?.id ?? null,
  }
}
