// lib/email-analytics/deliverability.ts
//
// Deliverability report (US-111). Combines:
//   • Internal send signals over the last 30d (bounce / complaint / delivery
//     rates) → a 0-100 reputation score + threshold alerts.
//   • A real DNSBL (blacklist) lookup against each verified sending domain's
//     resolved IPs, across well-known zones.
//   • Per-domain SPF / DKIM / DMARC status derived from the EmailDomain
//     dnsRecords plus a live DMARC TXT lookup.
//   • Actionable recommendations.

import dns from 'dns/promises'
import { getOrgEmailOverview } from './aggregate'
import { listOrgDomains } from '@/lib/email/orgDomains'
import type { EmailDomain, EmailDomainDnsRecord } from '@/lib/email/domains'

const DAY_MS = 24 * 60 * 60 * 1000

// Alert thresholds (industry-standard danger lines).
export const BOUNCE_RATE_ALERT = 0.05 // 5%
export const COMPLAINT_RATE_ALERT = 0.001 // 0.1%

// DNSBL zones we check. These are widely-used public blocklists. A listing on
// any of them materially hurts deliverability.
const DNSBL_ZONES = ['zen.spamhaus.org', 'b.barracudacentral.org', 'bl.spamcop.net']

export type AuthStatus = 'pass' | 'fail' | 'missing' | 'unknown'

export interface DomainAuthStatus {
  domainId: string
  domain: string
  verified: boolean
  spf: AuthStatus
  dkim: AuthStatus
  dmarc: AuthStatus
}

export interface BlacklistListing {
  ip: string
  zone: string
}

export interface BlacklistResult {
  // 'dns' when live DNSBL lookups ran; 'internal-signal' when DNS wasn't
  // feasible and we fell back to internal complaint/bounce signals.
  method: 'dns' | 'internal-signal'
  checkedIps: string[]
  checkedZones: string[]
  listings: BlacklistListing[]
  clean: boolean
  note?: string
}

export interface DeliverabilityAlert {
  level: 'warning' | 'critical'
  code: string
  message: string
}

export interface DeliverabilityReport {
  orgId: string
  range: { from: string; to: string }
  reputationScore: number // 0-100
  bounceRate30d: number // 0..1
  spamComplaintRate30d: number // 0..1
  deliveryRate30d: number // 0..1
  sent30d: number
  blacklist: BlacklistResult
  domains: DomainAuthStatus[]
  alerts: DeliverabilityAlert[]
  recommendations: string[]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Reputation score (0-100). Starts at 100 and deducts for bounces, complaints,
 * blacklist listings, and missing domain authentication. Low send volume keeps
 * the score neutral-high (we don't punish brand-new senders with no signal).
 */
function computeReputationScore(input: {
  bounceRate: number
  complaintRate: number
  deliveryRate: number
  sent: number
  blacklistListings: number
  domains: DomainAuthStatus[]
}): number {
  // No meaningful volume yet → neutral-high baseline.
  if (input.sent < 20) return 85

  let score = 100

  // Bounces: up to -40. 0% bounce = no penalty; 10%+ = full penalty.
  score -= clamp(input.bounceRate / 0.1, 0, 1) * 40

  // Complaints are far more damaging: up to -35. 0.5%+ = full penalty.
  score -= clamp(input.complaintRate / 0.005, 0, 1) * 35

  // Delivery rate shortfall below 95%: up to -15.
  const deliveryShortfall = clamp((0.95 - input.deliveryRate) / 0.2, 0, 1)
  score -= deliveryShortfall * 15

  // Each blacklist listing is a hard hit: -15 each, capped at -30.
  score -= clamp(input.blacklistListings * 15, 0, 30)

  // Missing authentication on any verified domain: -5 per missing mechanism,
  // capped at -15.
  let authPenalty = 0
  for (const d of input.domains) {
    if (!d.verified) continue
    if (d.spf !== 'pass') authPenalty += 5
    if (d.dkim !== 'pass') authPenalty += 5
    if (d.dmarc !== 'pass') authPenalty += 5
  }
  score -= clamp(authPenalty, 0, 15)

  return Math.round(clamp(score, 0, 100))
}

/**
 * Resolve a domain's A records to IPv4 addresses (best-effort).
 */
async function resolveIps(domain: string): Promise<string[]> {
  try {
    const ips = await dns.resolve4(domain)
    return ips.filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
  } catch {
    return []
  }
}

/**
 * Query a single DNSBL zone for a reversed IPv4. A successful A-record
 * resolution (typically 127.0.0.x) means the IP is listed.
 */
async function isListed(ip: string, zone: string): Promise<boolean> {
  const reversed = ip.split('.').reverse().join('.')
  try {
    const res = await dns.resolve4(`${reversed}.${zone}`)
    return res.length > 0
  } catch {
    // NXDOMAIN / no answer → not listed.
    return false
  }
}

/**
 * Run DNSBL lookups for the org's verified domains. Falls back to an
 * internal-signal verdict when no IPs are resolvable (e.g. DNS blocked in the
 * runtime, or domains not yet pointing anywhere).
 */
async function checkBlacklists(
  verifiedDomains: EmailDomain[],
  signals: { complaintRate: number; bounceRate: number },
): Promise<BlacklistResult> {
  const ipSet = new Set<string>()
  for (const d of verifiedDomains) {
    const ips = await resolveIps(d.name)
    ips.forEach((ip) => ipSet.add(ip))
  }
  const checkedIps = Array.from(ipSet)

  if (checkedIps.length === 0) {
    // No resolvable IPs → can't run a real DNSBL check. Derive a verdict from
    // internal signals so the panel still gives a useful answer.
    const clean = signals.complaintRate < COMPLAINT_RATE_ALERT && signals.bounceRate < BOUNCE_RATE_ALERT
    return {
      method: 'internal-signal',
      checkedIps: [],
      checkedZones: DNSBL_ZONES,
      listings: [],
      clean,
      note:
        'No resolvable sending IPs — blacklist status estimated from internal complaint/bounce signals rather than a live DNSBL lookup.',
    }
  }

  const listings: BlacklistListing[] = []
  for (const ip of checkedIps) {
    for (const zone of DNSBL_ZONES) {
      // Run sequentially-ish but tolerate failures per (ip,zone).
      // eslint-disable-next-line no-await-in-loop
      const listed = await isListed(ip, zone)
      if (listed) listings.push({ ip, zone })
    }
  }

  return {
    method: 'dns',
    checkedIps,
    checkedZones: DNSBL_ZONES,
    listings,
    clean: listings.length === 0,
  }
}

/**
 * Decide the SPF/DKIM status of a domain from its Resend dnsRecords. Resend
 * returns per-record `status` ("verified" / "not_started" / "pending" / etc.)
 * and tags records with a `type` of "SPF" / "DKIM" where applicable. We treat
 * the domain-level status as the source of truth for "all records verified".
 */
function recordStatus(records: EmailDomainDnsRecord[], kind: 'SPF' | 'DKIM'): AuthStatus {
  const matches = records.filter((r) => {
    const t = (r.type ?? '').toUpperCase()
    if (kind === 'SPF') return t === 'SPF' || (r.record === 'TXT' && /spf|mx/i.test(r.value))
    return t === 'DKIM' || r.record === 'CNAME'
  })
  if (matches.length === 0) return 'missing'
  const allVerified = matches.every((r) => (r.status ?? '').toLowerCase() === 'verified')
  if (allVerified) return 'pass'
  const anyFailed = matches.some((r) => /fail/i.test(r.status ?? ''))
  return anyFailed ? 'fail' : 'unknown'
}

/**
 * Live DMARC lookup. DMARC isn't part of Resend's records, so we query the
 * `_dmarc.<domain>` TXT directly.
 */
async function checkDmarc(domain: string): Promise<AuthStatus> {
  try {
    const txt = await dns.resolveTxt(`_dmarc.${domain}`)
    const flat = txt.map((chunks) => chunks.join('')).join(' ')
    if (/v=DMARC1/i.test(flat)) return 'pass'
    return 'missing'
  } catch {
    return 'missing'
  }
}

async function buildDomainAuth(domain: EmailDomain): Promise<DomainAuthStatus> {
  const records = domain.dnsRecords ?? []
  const verified = domain.status === 'verified'
  // For verified domains Resend has confirmed SPF + DKIM, so trust the
  // domain-level status; otherwise inspect per-record status.
  const spf = verified ? 'pass' : recordStatus(records, 'SPF')
  const dkim = verified ? 'pass' : recordStatus(records, 'DKIM')
  const dmarc = await checkDmarc(domain.name)
  return { domainId: domain.id, domain: domain.name, verified, spf, dkim, dmarc }
}

/**
 * Build the full deliverability report for an org over the last 30 days.
 */
export async function getDeliverabilityReport(orgId: string): Promise<DeliverabilityReport> {
  const to = new Date()
  const from = new Date(to.getTime() - 30 * DAY_MS)
  const range = { from, to }

  const overview = await getOrgEmailOverview(orgId, range)
  const bounceRate30d = overview.rates.bounceRate
  const deliveryRate30d = overview.rates.deliveryRate
  const sent30d = overview.totals.sent
  // Spam-complaint rate ≈ unsubscribes-on-complaint / delivered. The webhook
  // bumps stats.unsubscribed on email.complained, so unsubRate is our best
  // available complaint proxy.
  const spamComplaintRate30d = overview.rates.unsubRate

  const allDomains = await listOrgDomains(orgId)
  const verifiedDomains = allDomains.filter((d) => d.status === 'verified')

  const blacklist = await checkBlacklists(verifiedDomains, {
    complaintRate: spamComplaintRate30d,
    bounceRate: bounceRate30d,
  })

  const domains = await Promise.all(allDomains.map((d) => buildDomainAuth(d)))

  const reputationScore = computeReputationScore({
    bounceRate: bounceRate30d,
    complaintRate: spamComplaintRate30d,
    deliveryRate: deliveryRate30d,
    sent: sent30d,
    blacklistListings: blacklist.listings.length,
    domains,
  })

  // Alerts.
  const alerts: DeliverabilityAlert[] = []
  if (bounceRate30d > BOUNCE_RATE_ALERT) {
    alerts.push({
      level: 'critical',
      code: 'high-bounce-rate',
      message: `Bounce rate is ${(bounceRate30d * 100).toFixed(2)}% — above the ${(BOUNCE_RATE_ALERT * 100).toFixed(0)}% danger line. Clean your list to protect sender reputation.`,
    })
  }
  if (spamComplaintRate30d > COMPLAINT_RATE_ALERT) {
    alerts.push({
      level: 'critical',
      code: 'high-complaint-rate',
      message: `Spam complaint rate is ${(spamComplaintRate30d * 100).toFixed(3)}% — above the ${(COMPLAINT_RATE_ALERT * 100).toFixed(1)}% danger line. Review consent and send frequency.`,
    })
  }
  if (!blacklist.clean) {
    alerts.push({
      level: 'critical',
      code: 'blacklisted',
      message: `Sending IP listed on ${blacklist.listings.length} blocklist${blacklist.listings.length === 1 ? '' : 's'}. Request delisting and pause sends until resolved.`,
    })
  }
  for (const d of domains.filter((x) => x.verified)) {
    if (d.dmarc !== 'pass') {
      alerts.push({
        level: 'warning',
        code: 'missing-dmarc',
        message: `${d.domain} has no DMARC record. Add a _dmarc TXT record to improve inbox placement.`,
      })
    }
  }

  // Recommendations.
  const recommendations: string[] = []
  if (verifiedDomains.length === 0) {
    recommendations.push('Verify a sending domain so your mail is signed with your own SPF + DKIM instead of the shared domain.')
  }
  if (bounceRate30d > 0.02) {
    recommendations.push('Run a list-health clean to remove inactive and invalid addresses before your next send.')
  }
  if (spamComplaintRate30d > 0.0005) {
    recommendations.push('Add a visible one-click unsubscribe and reduce send frequency to keep complaints near zero.')
  }
  for (const d of domains.filter((x) => x.verified && x.dmarc !== 'pass')) {
    recommendations.push(`Publish a DMARC policy for ${d.domain} (start with p=none for monitoring).`)
  }
  if (reputationScore >= 90 && alerts.length === 0) {
    recommendations.push('Reputation is healthy. Keep warming volume gradually and monitor weekly.')
  }
  if (recommendations.length === 0) {
    recommendations.push('No urgent actions. Keep monitoring bounce and complaint rates after each send.')
  }

  return {
    orgId,
    range: { from: from.toISOString(), to: to.toISOString() },
    reputationScore,
    bounceRate30d,
    spamComplaintRate30d,
    deliveryRate30d,
    sent30d,
    blacklist,
    domains,
    alerts,
    recommendations,
  }
}
