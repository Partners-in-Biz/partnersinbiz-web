/**
 * Org health score (US-321).
 *
 * A documented, deterministic 0-100 score composed of three weighted pillars:
 *
 *   Engagement (40 pts) — recent activity: social posts, email sends, logins,
 *                         activity-log entries in the last 30 days.
 *   Billing    (35 pts) — billing state, overdue invoices, payment recency.
 *   Usage      (25 pts) — breadth of platform adoption: contacts, connected
 *                         social accounts, projects, campaigns.
 *
 * The score is intentionally explainable: every pillar returns its own subscore
 * and a list of human-readable factors so the admin UI can show the breakdown
 * and surface at-risk / upsell signals.
 */

export interface HealthInputs {
  // Engagement signals (last 30 days)
  socialPosts30d: number
  emailSends30d: number
  activityEvents30d: number
  lastLoginDaysAgo: number | null
  // Billing signals
  billingState: 'trial' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'unknown'
  overdueInvoices: number
  daysSinceLastPayment: number | null
  // Usage signals
  contactsCount: number
  connectedSocialAccounts: number
  activeProjects: number
  campaigns: number
}

export interface HealthPillar {
  key: 'engagement' | 'billing' | 'usage'
  label: string
  score: number
  max: number
  factors: string[]
}

export interface HealthResult {
  score: number
  band: 'healthy' | 'watch' | 'at_risk'
  pillars: HealthPillar[]
  alerts: Array<{ kind: 'at_risk' | 'upsell'; message: string }>
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function engagementPillar(i: HealthInputs): HealthPillar {
  const max = 40
  let score = 0
  const factors: string[] = []

  // Social posting cadence (up to 12)
  const social = clamp(i.socialPosts30d * 1.5, 0, 12)
  score += social
  factors.push(`${i.socialPosts30d} social posts in 30d (+${social.toFixed(0)})`)

  // Email activity (up to 10)
  const email = clamp(i.emailSends30d / 5, 0, 10)
  score += email
  factors.push(`${i.emailSends30d} email sends in 30d (+${email.toFixed(0)})`)

  // Activity log volume (up to 10)
  const activity = clamp(i.activityEvents30d / 3, 0, 10)
  score += activity
  factors.push(`${i.activityEvents30d} activity events in 30d (+${activity.toFixed(0)})`)

  // Login recency (up to 8)
  let login = 0
  if (i.lastLoginDaysAgo === null) {
    factors.push('No recorded login (+0)')
  } else if (i.lastLoginDaysAgo <= 3) {
    login = 8
    factors.push(`Last login ${i.lastLoginDaysAgo}d ago (+8)`)
  } else if (i.lastLoginDaysAgo <= 14) {
    login = 5
    factors.push(`Last login ${i.lastLoginDaysAgo}d ago (+5)`)
  } else if (i.lastLoginDaysAgo <= 30) {
    login = 2
    factors.push(`Last login ${i.lastLoginDaysAgo}d ago (+2)`)
  } else {
    factors.push(`Last login ${i.lastLoginDaysAgo}d ago (+0)`)
  }
  score += login

  return { key: 'engagement', label: 'Engagement', score: clamp(Math.round(score), 0, max), max, factors }
}

function billingPillar(i: HealthInputs): HealthPillar {
  const max = 35
  let score = 0
  const factors: string[] = []

  const stateScore: Record<HealthInputs['billingState'], number> = {
    active: 20,
    trial: 12,
    past_due: 4,
    paused: 6,
    cancelled: 0,
    unknown: 8,
  }
  const ss = stateScore[i.billingState]
  score += ss
  factors.push(`Billing state "${i.billingState}" (+${ss})`)

  // Overdue invoices penalty / clean bonus (up to 8)
  if (i.overdueInvoices === 0) {
    score += 8
    factors.push('No overdue invoices (+8)')
  } else {
    const penalty = clamp(i.overdueInvoices * 4, 0, 8)
    factors.push(`${i.overdueInvoices} overdue invoice(s) (+0, -${penalty} risk)`)
  }

  // Payment recency (up to 7)
  if (i.daysSinceLastPayment === null) {
    factors.push('No payment on record (+0)')
  } else if (i.daysSinceLastPayment <= 35) {
    score += 7
    factors.push(`Paid ${i.daysSinceLastPayment}d ago (+7)`)
  } else if (i.daysSinceLastPayment <= 70) {
    score += 3
    factors.push(`Paid ${i.daysSinceLastPayment}d ago (+3)`)
  } else {
    factors.push(`Paid ${i.daysSinceLastPayment}d ago (+0)`)
  }

  return { key: 'billing', label: 'Billing', score: clamp(Math.round(score), 0, max), max, factors }
}

function usagePillar(i: HealthInputs): HealthPillar {
  const max = 25
  let score = 0
  const factors: string[] = []

  const contacts = clamp(i.contactsCount / 20, 0, 8)
  score += contacts
  factors.push(`${i.contactsCount} contacts (+${contacts.toFixed(0)})`)

  const social = clamp(i.connectedSocialAccounts * 2, 0, 7)
  score += social
  factors.push(`${i.connectedSocialAccounts} connected social accounts (+${social.toFixed(0)})`)

  const projects = clamp(i.activeProjects * 1.5, 0, 5)
  score += projects
  factors.push(`${i.activeProjects} active projects (+${projects.toFixed(0)})`)

  const campaigns = clamp(i.campaigns, 0, 5)
  score += campaigns
  factors.push(`${i.campaigns} campaigns (+${campaigns.toFixed(0)})`)

  return { key: 'usage', label: 'Usage', score: clamp(Math.round(score), 0, max), max, factors }
}

export function computeHealthScore(inputs: HealthInputs): HealthResult {
  const pillars = [engagementPillar(inputs), billingPillar(inputs), usagePillar(inputs)]
  const score = clamp(pillars.reduce((sum, p) => sum + p.score, 0), 0, 100)
  const band: HealthResult['band'] = score >= 70 ? 'healthy' : score >= 45 ? 'watch' : 'at_risk'

  const alerts: HealthResult['alerts'] = []
  if (band === 'at_risk') {
    alerts.push({ kind: 'at_risk', message: 'Overall health is at-risk — review engagement and billing.' })
  }
  if (inputs.overdueInvoices > 0) {
    alerts.push({ kind: 'at_risk', message: `${inputs.overdueInvoices} overdue invoice(s) — billing follow-up needed.` })
  }
  if (inputs.lastLoginDaysAgo !== null && inputs.lastLoginDaysAgo > 30) {
    alerts.push({ kind: 'at_risk', message: `No login in ${inputs.lastLoginDaysAgo} days — churn risk.` })
  }
  // Upsell: strongly engaged + healthy billing + room to grow usage.
  const engagement = pillars[0]
  const usage = pillars[2]
  if (band === 'healthy' && engagement.score >= 30 && usage.score < usage.max * 0.6) {
    alerts.push({ kind: 'upsell', message: 'High engagement with low feature adoption — upsell opportunity.' })
  }

  return { score, band, pillars, alerts }
}
