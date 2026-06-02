// lib/reports/types.ts
//
// Reports are immutable summaries of an org's KPIs over a time window.
// One row in the `reports` collection. Reports are generated from the
// metrics fact table — never from upstream provider APIs directly.

export type ReportType = 'monthly' | 'quarterly' | 'ad_hoc' | 'launch_review'
export type ReportStatus = 'draft' | 'rendered' | 'sent' | 'archived'

export interface ReportPeriod {
  start: string // 'YYYY-MM-DD' inclusive
  end: string // 'YYYY-MM-DD' inclusive
  tz: string // IANA timezone the period was closed in
}

/**
 * KPI snapshot — immutable once finalised. Numbers are pre-computed in ZAR
 * for headline comparisons; native amounts in `breakdowns`.
 */
export interface ReportKpis {
  /** Total invoiced revenue (PiB invoices), period sum, ZAR. */
  invoiced_revenue: number
  invoiced_revenue_paid: number
  outstanding: number

  /** Subscription metrics — last value (stock) within period. */
  mrr: number
  arr: number
  active_subs: number
  new_subs: number
  trials_started: number
  trials_converted: number
  churn: number
  subscription_revenue: number

  /** Ad metrics — sum within period, ZAR for revenue, raw counts otherwise. */
  ad_revenue: number
  impressions: number
  clicks: number

  /** Mobile metrics — sum within period. */
  installs: number
  uninstalls: number
  iap_revenue: number

  /** Web/analytics — sum within period. */
  sessions: number
  pageviews: number
  users: number
  conversions: number

  /** Marketing — sum within period. */
  ad_spend: number
  /** Last-row roas in period — closest to current. */
  roas: number | null

  /** Net revenue across all sources, ZAR. */
  total_revenue: number

  /** Period-over-period delta, percentage. null when previous period had 0. */
  deltas: {
    total_revenue: number | null
    mrr: number | null
    active_subs: number | null
    sessions: number | null
    ad_revenue: number | null
    iap_revenue: number | null
    installs: number | null
  }
}

export interface ReportSeries {
  metric: string
  series: Array<{ date: string; value: number }>
}

export interface Report {
  id: string
  orgId: string
  /** Optional single-property scope. Missing means org-wide. */
  propertyId?: string
  type: ReportType
  period: ReportPeriod
  /** Inclusive prior period used for delta calculations. */
  previousPeriod: ReportPeriod
  status: ReportStatus

  /** Pre-computed KPIs. */
  kpis: ReportKpis

  /** Per-property KPI snapshot. Empty for org-wide reports without property scope. */
  properties: Array<{ propertyId: string; name: string; type: string; kpis: Partial<ReportKpis> }>

  /** Up to ~7 daily series — used to draw mini charts. */
  series: ReportSeries[]

  /** AI-generated 3-paragraph executive summary — editable. */
  exec_summary: string
  /** AI-generated bullet highlights (max 5) — editable. */
  highlights: string[]

  /** Public access token (random 24-byte url-safe). Set on render. */
  publicToken: string | null

  /** Where it was sent. */
  sentTo: string[]
  sentAt: unknown | null
  viewedAt: unknown | null

  /** Branding — copied at generation time so reports remain stable. */
  brand: {
    orgName: string
    orgLogoUrl: string | null
    accent: string
    bg: string
    text: string
  }

  generatedBy: 'cron' | 'admin' | 'agent'
  createdAt: unknown
  createdBy: string
  updatedAt: unknown
}

export const REPORTS_COLLECTION = 'reports'
