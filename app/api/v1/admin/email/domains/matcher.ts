// app/api/v1/admin/email/domains/matcher.ts
//
// Reusable matcher for the admin email-domain allow/block ruleset
// (`admin_email_domain_rules`). Kept colocated with the route (per task scope —
// no new lib/ helper). A rule's `domain` field is either an exact domain
// ("acme.co.za") or a glob-style pattern ("*.acme.co.za", "*@gmail.com").
//
// Enforcement intent: domain-verification / recipient-acceptance paths should
// resolve an address or domain against these rules. A 'block' match denies; an
// 'allow' match (with autoApprove) can fast-track verification. The most
// specific match wins; an exact match beats a wildcard.

export type DomainRuleType = 'allow' | 'block'

export interface DomainRule {
  id: string
  domain: string // exact domain or glob pattern
  type: DomainRuleType
  reason: string
  autoApprove: boolean
  createdBy?: string
  createdByType?: string
  createdAt?: string | null
  updatedAt?: string | null
}

/** Extract the domain portion from an email address or bare domain. */
export function extractDomain(input: string): string {
  const v = (input ?? '').trim().toLowerCase()
  if (!v) return ''
  const at = v.lastIndexOf('@')
  return at >= 0 ? v.slice(at + 1) : v
}

/**
 * Convert a rule pattern into a RegExp. Supports `*` as a wildcard for any run
 * of characters. Patterns may target the full address ("*@gmail.com") or just
 * the domain ("*.acme.co.za"). All other regex metacharacters are escaped.
 */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/** Specificity score — exact (no wildcard) and longer patterns rank higher. */
function specificity(pattern: string): number {
  const wild = (pattern.match(/\*/g) ?? []).length
  return pattern.length - wild * 100
}

export interface RuleMatch {
  rule: DomainRule
  matched: 'address' | 'domain'
}

/**
 * Find the winning rule for an email address (or bare domain). The candidate is
 * tested against each rule's pattern as both the full address and the extracted
 * domain. The most specific match wins; ties resolve to 'block' over 'allow'
 * (fail-safe).
 */
export function matchDomainRule(address: string, rules: DomainRule[]): RuleMatch | null {
  const addr = (address ?? '').trim().toLowerCase()
  if (!addr) return null
  const domain = extractDomain(addr)

  const hits: Array<RuleMatch & { score: number }> = []
  for (const rule of rules) {
    const pat = (rule.domain ?? '').trim().toLowerCase()
    if (!pat) continue
    let re: RegExp
    try {
      re = patternToRegExp(pat)
    } catch {
      continue
    }
    if (re.test(addr)) {
      hits.push({ rule, matched: 'address', score: specificity(pat) })
    } else if (domain && re.test(domain)) {
      hits.push({ rule, matched: 'domain', score: specificity(pat) })
    }
  }
  if (hits.length === 0) return null

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Tie-break: block beats allow.
    if (a.rule.type !== b.rule.type) return a.rule.type === 'block' ? -1 : 1
    return 0
  })
  const top = hits[0]
  return { rule: top.rule, matched: top.matched }
}

/**
 * High-level decision helper. Returns the effective action for an address.
 *   • 'block'   — a block rule matched.
 *   • 'allow'   — an allow rule matched.
 *   • 'neutral' — no rule matched (caller applies its own default policy).
 */
export function evaluateAddress(
  address: string,
  rules: DomainRule[],
): { action: DomainRuleType | 'neutral'; rule: DomainRule | null; autoApprove: boolean } {
  const m = matchDomainRule(address, rules)
  if (!m) return { action: 'neutral', rule: null, autoApprove: false }
  return {
    action: m.rule.type,
    rule: m.rule,
    autoApprove: m.rule.type === 'allow' && !!m.rule.autoApprove,
  }
}
